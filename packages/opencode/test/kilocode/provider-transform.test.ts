import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

describe("Kilo provider transform variants", () => {
  const model = (overrides: Partial<any> = {}): any => ({
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
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
  })

  test("uses cached reasoning_options for claude fable 5 efforts", () => {
    const result = ProviderTransform.variants(
      model({
        id: "anthropic/claude-fable-5",
        providerID: "anthropic",
        api: {
          id: "claude-fable-5",
          url: "https://api.anthropic.com",
          npm: "@ai-sdk/anthropic",
        },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
      }),
    )
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(result.xhigh).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      effort: "xhigh",
    })
  })

  test("uses cached reasoning_options for openai-compatible claude models", () => {
    const result = ProviderTransform.variants(
      model({
        id: "claude-fable-5",
        providerID: "opencode",
        api: {
          id: "claude-fable-5",
          url: "https://opencode.ai/zen/v1",
          npm: "@ai-sdk/openai-compatible",
        },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
      }),
    )
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(result.max).toEqual({ reasoningEffort: "max" })
  })

  test("uses provider-specific cached reasoning_options for ai gateway claude models", () => {
    const result = ProviderTransform.variants(
      model({
        id: "anthropic/claude-fable-5",
        providerID: "cloudflare-ai-gateway",
        api: {
          id: "anthropic/claude-fable-5",
          url: "https://gateway.ai",
          npm: "ai-gateway-provider",
        },
        reasoning_options: [{ type: "effort", values: ["low", "medium", "high"] }],
      }),
    )
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    expect(result.high).toEqual({ reasoningEffort: "high" })
  })

  test("adds max reasoning effort for GPT-5.6 OpenAI models", () => {
    const result = ProviderTransform.variants(
      model({
        id: "gpt-5.6-sol",
        providerID: "openai",
        api: {
          id: "gpt-5.6-sol",
          url: "https://api.openai.com/v1",
          npm: "@ai-sdk/openai",
        },
      }),
    )

    expect(Object.keys(result)).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(result.max).toEqual({
      reasoningEffort: "max",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })
  })
})
