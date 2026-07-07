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
  test("keeps max first for OpenAI-compatible custom providers", () => {
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

    expect(Object.keys(variants)).toEqual(["max", "high"])
  })

  test("keeps xhigh first for OpenRouter", () => {
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

    expect(Object.keys(variants)).toEqual(["xhigh", "high"])
  })
})
