import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

type Model = Parameters<typeof ProviderTransform.variants>[0]

const model = (overrides: Record<string, unknown> = {}): Model =>
  ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: {
      context: 200_000,
      output: 64_000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  }) as Model

describe("GLM-5.2 variant order", () => {
  // 变体键序与上游 v7.4.16 一致：high 在前、更强档位（max/xhigh）在后（审核条目 F42）。
  test("keeps high first for OpenAI-compatible custom providers (matches upstream)", () => {
    const variants = ProviderTransform.variants(
      model({
        id: "glm-5.2",
        api: {
          id: "glm-5.2",
          url: "https://api.test.com",
          npm: "@ai-sdk/openai-compatible",
        },
      }),
    )

    expect(Object.keys(variants)).toEqual(["high", "max"])
    expect(variants.max).toEqual({ reasoningEffort: "max" })
  })

  test("keeps high first for OpenRouter (matches upstream)", () => {
    const variants = ProviderTransform.variants(
      model({
        id: "openrouter/z-ai/glm-5.2",
        api: {
          id: "z-ai/glm-5.2",
          url: "https://openrouter.ai/api/v1",
          npm: "@openrouter/ai-sdk-provider",
        },
      }),
    )

    expect(Object.keys(variants)).toEqual(["high", "xhigh"])
    expect(variants.xhigh).toEqual({ reasoning: { effort: "xhigh" } })
  })

  // @ai-sdk/openai 分支为 Kilo 新增（上游无此分支），顺序对齐同族的 openai-compatible 分支。
  test("keeps high first for the Kilo-only @ai-sdk/openai branch", () => {
    const variants = ProviderTransform.variants(
      model({
        id: "glm-5.2",
        api: {
          id: "glm-5.2",
          url: "https://api.test.com",
          npm: "@ai-sdk/openai",
        },
      }),
    )

    expect(Object.keys(variants)).toEqual(["high", "max"])
  })

  test("keeps high first for @ai-sdk/anthropic (matches upstream)", () => {
    const variants = ProviderTransform.variants(
      model({
        id: "glm-5.2",
        api: {
          id: "glm-5.2",
          url: "https://api.test.com",
          npm: "@ai-sdk/anthropic",
        },
      }),
    )

    expect(Object.keys(variants)).toEqual(["high", "max"])
    expect(variants.max).toEqual({ effort: "max" })
  })
})
