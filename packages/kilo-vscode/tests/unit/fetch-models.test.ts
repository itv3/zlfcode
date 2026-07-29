import { describe, expect, it } from "bun:test"
import { fetchModels, fetchOpenAIModels } from "../../src/shared/fetch-models"
import type { FetchModelsProtocol } from "../../src/shared/fetch-models"

function serve(body: unknown, check?: (req: Request) => void) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      check?.(req)
      return Response.json(body)
    },
  })
}

async function models(protocol: FetchModelsProtocol, body: unknown, check?: (req: Request) => void) {
  const server = serve(body, check)
  try {
    return await fetchModels({ baseURL: server.url.toString().replace(/\/$/, ""), apiKey: "key", protocol })
  } finally {
    server.stop(true)
  }
}

describe("fetchModels", () => {
  it("parses OpenAI-compatible model lists", async () => {
    const out = await models(
      "openai",
      { data: [{ id: "gpt-4o", name: "GPT 4o", context_length: 128000, max_output_tokens: 16384 }] },
      (req) => expect(req.headers.get("authorization")).toBe("Bearer key"),
    )

    expect(out).toEqual([{ id: "gpt-4o", name: "GPT 4o", contextLimit: 128000, outputLimit: 16384 }])
  })

  it("keeps fetchOpenAIModels as the OpenAI-compatible export", async () => {
    const server = serve({ data: [{ id: "gpt-4.1", name: "GPT 4.1" }] }, (req) => {
      expect(new URL(req.url).pathname).toBe("/models")
      expect(req.headers.get("authorization")).toBe("Bearer key")
    })
    try {
      const out = await fetchOpenAIModels({ baseURL: server.url.toString().replace(/\/$/, ""), apiKey: "key" })
      expect(out).toEqual([{ id: "gpt-4.1", name: "GPT 4.1" }])
    } finally {
      server.stop(true)
    }
  })

  it("parses OpenRouter-style pricing from OpenAI-compatible model lists", async () => {
    const out = await models("openai", {
      data: [
        {
          id: "gpt-4o",
          name: "GPT 4o",
          pricing: {
            prompt: "0.0000025",
            completion: "0.00001",
            input_cache_read: "0.00000125",
            input_cache_write: "0.00000375",
          },
        },
      ],
    })

    expect(out).toEqual([
      {
        id: "gpt-4o",
        name: "GPT 4o",
        inputCost: 2.5,
        outputCost: 10,
        cacheReadCost: 1.25,
        cacheWriteCost: 3.75,
      },
    ])
  })

  it("parses LiteLLM-style per-token costs from OpenAI-compatible model lists", async () => {
    const out = await models("openai", {
      data: [
        {
          id: "model-1",
          input_cost_per_token: 0.000003,
          output_cost_per_token: 0.000015,
        },
      ],
    })

    expect(out).toEqual([{ id: "model-1", name: "model-1", inputCost: 3, outputCost: 15 }])
  })

  it("parses Anthropic model lists", async () => {
    const out = await models(
      "anthropic",
      { data: [{ id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" }] },
      (req) => {
        expect(new URL(req.url).pathname).toBe("/v1/models")
        expect(req.headers.get("x-api-key")).toBe("key")
        expect(req.headers.get("anthropic-version")).toBe("2023-06-01")
      },
    )

    expect(out).toEqual([{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }])
  })

  it("does not duplicate v1 when fetching Anthropic model lists", async () => {
    const server = serve({ data: [{ id: "claude-opus-4-8" }] }, (req) => {
      expect(new URL(req.url).pathname).toBe("/v1/models")
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, "") + "/v1",
        apiKey: "key",
        protocol: "anthropic",
      })
      expect(out).toEqual([{ id: "claude-opus-4-8", name: "claude-opus-4-8" }])
    } finally {
      server.stop(true)
    }
  })

  it("parses Gemini model lists and strips the models prefix", async () => {
    const out = await models(
      "gemini",
      {
        models: [
          {
            name: "models/gemini-2.5-pro",
            displayName: "Gemini 2.5 Pro",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
          },
        ],
      },
      (req) => {
        // baseURL 未带版本段时,入口规范化应自动补 /v1beta(与 Anthropic 分支同款防御)。
        expect(new URL(req.url).pathname).toBe("/v1beta/models")
        expect(req.headers.get("x-goog-api-key")).toBe("key")
      },
    )

    expect(out).toEqual([{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLimit: 1048576, outputLimit: 65536 }])
  })

  it("keeps a Gemini v1alpha base URL without appending v1beta", async () => {
    // F23 回归:以 /v1alpha 结尾的 baseURL 视为已带版本段,
    // 不应被误补成 /v1alpha/v1beta 导致 404。
    const server = serve({ models: [{ name: "models/gemini-exp" }] }, (req) => {
      expect(new URL(req.url).pathname).toBe("/v1alpha/models")
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, "") + "/v1alpha",
        apiKey: "key",
        protocol: "gemini",
      })
      expect(out).toEqual([{ id: "gemini-exp", name: "gemini-exp" }])
    } finally {
      server.stop(true)
    }
  })

  it("filters Gemini models that cannot generate content", async () => {
    const out = await models("gemini", {
      models: [
        // 支持 generateContent:保留。
        { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent", "countTokens"] },
        // 只支持 streamGenerateContent:同样视为可聊天,保留。
        { name: "models/gemini-stream-only", supportedGenerationMethods: ["streamGenerateContent"] },
        // embedding 类模型:排除。
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
        // 图像生成类模型:排除。
        { name: "models/imagen-3.0", supportedGenerationMethods: ["predict"] },
        // 字段缺失(非官方网关):保守放行。
        { name: "models/gateway-model" },
      ],
    })

    expect(out.map((m) => m.id)).toEqual(["gateway-model", "gemini-2.5-pro", "gemini-stream-only"])
  })

  it("follows Anthropic has_more pagination and requests the maximum page size", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        expect(url.pathname).toBe("/v1/models")
        // 每页都应显式请求 API 上限 limit=1000。
        expect(url.searchParams.get("limit")).toBe("1000")
        const after = url.searchParams.get("after_id")
        if (!after) {
          return Response.json({ data: [{ id: "claude-page-1" }], has_more: true, last_id: "claude-page-1" })
        }
        expect(after).toBe("claude-page-1")
        return Response.json({ data: [{ id: "claude-page-2" }], has_more: false, last_id: "claude-page-2" })
      },
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, ""),
        apiKey: "key",
        protocol: "anthropic",
      })
      expect(out.map((m) => m.id)).toEqual(["claude-page-1", "claude-page-2"])
    } finally {
      server.stop(true)
    }
  })

  it("caps Anthropic pagination when the endpoint always reports more pages", async () => {
    let requests = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++
        // 恶意/异常 endpoint:永远宣称还有下一页,且游标持续变化。
        return Response.json({ data: [{ id: `model-${requests}` }], has_more: true, last_id: `model-${requests}` })
      },
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, ""),
        apiKey: "key",
        protocol: "anthropic",
      })
      // 最大页数保护:最多请求 10 页后停止,不会无限循环。
      expect(requests).toBe(10)
      expect(out).toHaveLength(10)
    } finally {
      server.stop(true)
    }
  })

  it("stops Anthropic pagination when the cursor does not advance", async () => {
    let requests = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++
        // 异常 endpoint:has_more=true 但游标停在原地,应立即停止而不是拉满 10 页。
        return Response.json({ data: [{ id: "same-model" }], has_more: true, last_id: "stuck" })
      },
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, ""),
        apiKey: "key",
        protocol: "anthropic",
      })
      expect(requests).toBe(2)
      expect(out.map((m) => m.id)).toEqual(["same-model"])
    } finally {
      server.stop(true)
    }
  })

  it("follows Gemini nextPageToken pagination and requests the maximum page size", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        expect(url.pathname).toBe("/v1beta/models")
        // 每页都应显式请求 pageSize=1000。
        expect(url.searchParams.get("pageSize")).toBe("1000")
        const token = url.searchParams.get("pageToken")
        if (!token) {
          return Response.json({ models: [{ name: "models/gemini-page-1" }], nextPageToken: "token-2" })
        }
        expect(token).toBe("token-2")
        return Response.json({ models: [{ name: "models/gemini-page-2" }] })
      },
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, ""),
        apiKey: "key",
        protocol: "gemini",
      })
      expect(out.map((m) => m.id)).toEqual(["gemini-page-1", "gemini-page-2"])
    } finally {
      server.stop(true)
    }
  })

  it("stops Gemini pagination on an empty page even when a fresh token is returned", async () => {
    // F64 回归：与 Anthropic 分支对称——异常 endpoint 用不断变化的 token
    // 配空 models 数组时应立即终止，而不是空转拉满 10 页。
    let requests = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++
        return Response.json({ models: [], nextPageToken: `token-${requests}` })
      },
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, ""),
        apiKey: "key",
        protocol: "gemini",
      })
      expect(requests).toBe(1)
      expect(out).toEqual([])
    } finally {
      server.stop(true)
    }
  })

  it("reports a malformed base URL as a FetchModelsError instead of a raw TypeError", async () => {
    // F70 回归：baseURL 没有完整 schema 校验，畸形输入进入分页 URL 构造时
    // 应抛出语义化的 FetchModelsError（webview 错误文案可读），而非原生 TypeError。
    await expect(
      fetchModels({ baseURL: "http://[malformed", apiKey: "key", protocol: "gemini" }),
    ).rejects.toThrow("Invalid base URL")
  })

  it("caps Gemini pagination when the endpoint always returns a next page token", async () => {
    let requests = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++
        return Response.json({ models: [{ name: `models/model-${requests}` }], nextPageToken: `token-${requests}` })
      },
    })
    try {
      const out = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, ""),
        apiKey: "key",
        protocol: "gemini",
      })
      expect(requests).toBe(10)
      expect(out).toHaveLength(10)
    } finally {
      server.stop(true)
    }
  })

  it("applies the response size limit across paginated requests", async () => {
    // 每页约 1.1MB:单页未超 2MB,但两页累计超过,应在第二页触发累计上限。
    const padding = "x".repeat(1_100_000)
    let requests = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++
        return Response.json({
          data: [{ id: `model-${requests}`, description: padding }],
          has_more: true,
          last_id: `model-${requests}`,
        })
      },
    })
    try {
      await expect(
        fetchModels({ baseURL: server.url.toString().replace(/\/$/, ""), apiKey: "key", protocol: "anthropic" }),
      ).rejects.toThrow("Model response is too large")
      expect(requests).toBe(2)
    } finally {
      server.stop(true)
    }
  })

  it("does not expose error response bodies", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("secret-token-from-upstream", { status: 500 })
      },
    })
    try {
      const message = await fetchModels({
        baseURL: server.url.toString().replace(/\/$/, ""),
        apiKey: "key",
        protocol: "openai",
      })
        .then(() => "")
        .catch((err) => (err instanceof Error ? err.message : String(err)))
      expect(message).toContain("HTTP 500")
      expect(message).not.toContain("secret-token-from-upstream")
    } finally {
      server.stop(true)
    }
  })

  it("normalizes model fetch timeout failures", async () => {
    const prev = globalThis.fetch
    globalThis.fetch = (async () => {
      const err = new Error("The operation was aborted due to timeout")
      err.name = "TimeoutError"
      throw err
    }) as typeof fetch

    try {
      await expect(
        fetchModels({
          baseURL: "https://example.com/v1",
          apiKey: "key",
          protocol: "openai",
        }),
      ).rejects.toThrow("Timed out")
    } finally {
      globalThis.fetch = prev
    }
  })

  it("does not follow redirects while sending API keys", async () => {
    const target = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ data: [] })
      },
    })
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.redirect(target.url.toString(), 302)
      },
    })
    try {
      await expect(
        fetchModels({ baseURL: server.url.toString().replace(/\/$/, ""), apiKey: "key", protocol: "anthropic" }),
      ).rejects.toThrow("HTTP 302")
    } finally {
      server.stop(true)
      target.stop(true)
    }
  })

  it("rejects oversized model responses", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("x".repeat(2_000_001), { headers: { "content-type": "application/json" } })
      },
    })
    try {
      await expect(
        fetchModels({ baseURL: server.url.toString().replace(/\/$/, ""), apiKey: "key", protocol: "openai" }),
      ).rejects.toThrow("Model response is too large")
    } finally {
      server.stop(true)
    }
  })
})
