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
      (req) => expect(req.headers.get("x-goog-api-key")).toBe("key"),
    )

    expect(out).toEqual([{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextLimit: 1048576, outputLimit: 65536 }])
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
