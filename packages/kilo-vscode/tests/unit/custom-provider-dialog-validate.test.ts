import { describe, expect, it } from "bun:test"
import { createStore } from "solid-js/store"
import { validateCustomProvider } from "../../webview-ui/src/components/settings/CustomProviderValidation"
import type { FormState } from "../../webview-ui/src/components/settings/CustomProviderValidation"

// Simple translator that returns the key so tests can assert on key names
const t = (key: string) => key

function base(): FormState {
  return {
    providerID: "my-provider",
    name: "My Provider",
    npm: "@ai-sdk/openai-compatible",
    baseURL: "https://example.com/v1",
    apiKey: "",
    models: [
      {
        id: "model-1",
        name: "Model One",
        supportsImages: false,
        modalities: {},
        contextLimit: "",
        outputLimit: "",
        costEnabled: false,
        inputCost: "",
        outputCost: "",
        cacheReadCost: "",
        cacheWriteCost: "",
        reasoning: false,
        variants: [],
      },
    ],
    headers: [],
    saving: false,
  }
}

function args(form: FormState) {
  return {
    form,
    t,
    editing: false,
    disabledProviders: [],
    existingProviderIDs: new Set<string>(),
  }
}

describe("validateCustomProvider – variant name validation", () => {
  it("persists the selected provider package", () => {
    const form = base()
    form.npm = "@ai-sdk/openai"

    expect(validateCustomProvider(args(form)).result?.config.npm).toBe("@ai-sdk/openai")
  })

  it("allows reconnecting a disabled provider id", () => {
    const form = base()
    const out = validateCustomProvider({
      ...args(form),
      disabledProviders: ["my-provider"],
      existingProviderIDs: new Set(["my-provider"]),
    })

    expect(out.result?.providerID).toBe("my-provider")
    expect(out.errors.providerID).toBeUndefined()
  })

  it("allows submit when reasoning is enabled with no variants", () => {
    const form = base()
    form.models[0].reasoning = true
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    expect(out.errors.models[0].variants).toEqual([])
  })

  it("allows submit when reasoning is enabled with a named variant", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBeUndefined()
  })

  it("blocks submit and reports error when reasoning is enabled with an empty variant name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBe("provider.custom.error.required")
  })

  it("blocks submit and reports error when reasoning is enabled with a whitespace-only variant name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "   ",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[0]?.name).toBe("provider.custom.error.required")
  })

  it("blocks submit and reports duplicate error for two variants with the same name", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
      {
        name: "fast",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].variants?.[1]?.name).toBe("provider.custom.error.duplicate")
  })

  it("ignores variants entirely when reasoning is disabled, even if they have empty names", () => {
    const form = base()
    form.models[0].reasoning = false
    form.models[0].variants = [
      {
        name: "",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    // No variant errors produced; form is allowed to submit
    expect(out.errors.models[0].variants).toEqual([])
    // Variant is not included in the saved config
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.variants).toBeUndefined()
    expect(saved.modalities).toBeUndefined()
  })

  it("treats model IDs differing only in case as duplicates", () => {
    const form = base()
    const model = form.models[0]
    form.models = [
      { ...model, id: "qwen2.5-coder:14b", name: "Qwen" },
      { ...model, id: "QWEN2.5-CODER:14B", name: "Qwen Upper" },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].id).toBeUndefined()
    expect(out.errors.models[1].id).toBe("provider.custom.error.duplicate")
  })

  it("persists named variants in the saved config when reasoning is enabled", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "eco",
        enableThinking: true,
        thinking: "adaptive",
        splitReasoning: false,
        outputEffort: "max",
        reasoningEffort: "low",
        chatTemplateArgs: undefined,
      },
    ]
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.variants).toEqual({
      eco: {
        enable_thinking: true,
        thinking: { type: "adaptive" },
        reasoning_split: false,
        effort: "max",
        reasoningEffort: "low",
      },
    })
  })

  it("preserves provider-native variant fields while saving known edits", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "xhigh",
        extras: { reasoning: { effort: "xhigh" } },
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: undefined,
        chatTemplateArgs: undefined,
      },
      {
        name: "high",
        extras: {
          thinking: { display: "summarized" },
          thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
        },
        enableThinking: undefined,
        thinking: "adaptive",
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: "high",
        chatTemplateArgs: undefined,
      },
    ]

    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as { variants: Record<string, unknown> }
    expect(saved.variants).toEqual({
      xhigh: { reasoning: { effort: "xhigh" } },
      high: {
        thinking: { display: "summarized", type: "adaptive" },
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
        reasoningEffort: "high",
      },
    })
  })

  it("drops preserved object fragments when their required editable field is unset", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "high",
        extras: {
          thinking: { display: "summarized" },
          chat_template_args: { extra: true },
          thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
        },
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: "high",
        chatTemplateArgs: undefined,
      },
    ]

    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as { variants: Record<string, unknown> }
    expect(saved.variants).toEqual({
      high: {
        thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
        reasoningEffort: "high",
      },
    })
  })

  it("preserves variant order in the saved config", () => {
    const form = base()
    form.models[0].reasoning = true
    form.models[0].variants = [
      {
        name: "low",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: "low",
        chatTemplateArgs: undefined,
      },
      {
        name: "medium",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: "medium",
        chatTemplateArgs: undefined,
      },
      {
        name: "high",
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        outputEffort: undefined,
        reasoningEffort: "high",
        chatTemplateArgs: undefined,
      },
    ]

    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as { variants: Record<string, unknown> }
    expect(Object.keys(saved.variants)).toEqual(["low", "medium", "high"])
  })

  it("persists image and token limits in the saved config", () => {
    const form = base()
    form.models[0].supportsImages = true
    form.models[0].modalities = { input: ["text"], output: ["text"] }
    form.models[0].contextLimit = "128000"
    form.models[0].outputLimit = "8192"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text", "image"], output: ["text"] })
    expect(saved.limit).toEqual({ context: 128000, output: 8192 })
  })

  it("preserves output modalities while saving model capabilities", () => {
    const form = base()
    form.models[0].modalities = { input: ["text"], output: ["text", "image"] }
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text"], output: ["text", "image"] })
  })

  it("returns a structured-cloneable save payload", () => {
    const src = base()
    src.models[0].modalities = { input: ["text"], output: ["text", "image"] }
    const [form] = createStore(src)
    const out = validateCustomProvider(args(form))

    expect(() => structuredClone(out.result?.config)).not.toThrow()
  })

  it("requires token limits to be filled as a pair", () => {
    const form = base()
    form.models[0].outputLimit = "8192"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].contextLimit).toBe("provider.custom.error.required")
  })

  it("persists model costs in the saved config", () => {
    const form = base()
    form.models[0].costEnabled = true
    form.models[0].inputCost = "3.00"
    form.models[0].outputCost = "15.25"
    form.models[0].cacheReadCost = "0.30"
    form.models[0].cacheWriteCost = "6.25"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.cost).toEqual({ input: 3, output: 15.25, cache_read: 0.3, cache_write: 6.25 })
  })

  it("accepts leading decimal model costs", () => {
    const form = base()
    form.models[0].costEnabled = true
    form.models[0].inputCost = ".50"
    form.models[0].outputCost = "5."
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.cost).toEqual({ input: 0.5, output: 5 })
  })

  it("requires input and output cost when cost options are enabled", () => {
    const form = base()
    form.models[0].costEnabled = true
    form.models[0].cacheReadCost = "0.3"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].inputCost).toBe("provider.custom.error.required")
    expect(out.errors.models[0].outputCost).toBe("provider.custom.error.required")
  })

  it("does not persist model costs when cost options are disabled", () => {
    const form = base()
    form.models[0].inputCost = "3"
    form.models[0].outputCost = "15"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.cost).toBeUndefined()
  })

  it("rejects invalid model costs", () => {
    const form = base()
    form.models[0].costEnabled = true
    form.models[0].inputCost = "-1"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].inputCost).toBe("provider.custom.error.cost")
  })

  it("preserves model costs with more than two decimal places", () => {
    const form = base()
    form.models[0].costEnabled = true
    form.models[0].inputCost = "1.234"
    form.models[0].outputCost = "0.075"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.cost).toEqual({ input: 1.234, output: 0.075 })
  })

  it("normalizes Gemini native base URLs to v1beta", () => {
    const form = base()
    form.npm = "@ai-sdk/google"
    form.baseURL = "https://api.3a.bin"
    const out = validateCustomProvider(args(form))
    expect(out.result?.config.options.baseURL).toBe("https://api.3a.bin/v1beta")
  })

  it("normalizes Anthropic native base URLs to v1", () => {
    const form = base()
    form.npm = "@ai-sdk/anthropic"
    form.baseURL = "https://api.3a.bin"
    const out = validateCustomProvider(args(form))
    expect(out.result?.config.options.baseURL).toBe("https://api.3a.bin/v1")
  })

  it("accepts the sg_anthropic Anthropic provider with a manually added Opus 4.8 model", () => {
    const form = base()
    form.providerID = "sg_anthropic"
    form.name = "sg_anthropic"
    form.npm = "@ai-sdk/anthropic"
    form.baseURL = "https://sg.3ab.in"
    form.apiKey = "sk-test"
    form.models = [
      {
        id: "claude-opus-4-8",
        name: "claude-opus-4-8",
        supportsImages: false,
        modalities: { input: ["text"], output: ["text"] },
        contextLimit: "",
        outputLimit: "",
        costEnabled: false,
        inputCost: "",
        outputCost: "",
        cacheReadCost: "",
        cacheWriteCost: "",
        reasoning: false,
        variants: [],
      },
    ]

    const out = validateCustomProvider(args(form))

    expect(out.result?.providerID).toBe("sg_anthropic")
    expect(out.result?.key).toBe("sk-test")
    expect(out.result?.config).toMatchObject({
      npm: "@ai-sdk/anthropic",
      name: "sg_anthropic",
      options: { baseURL: "https://sg.3ab.in/v1" },
      models: {
        "claude-opus-4-8": {
          name: "claude-opus-4-8",
          modalities: { input: ["text"], output: ["text"] },
        },
      },
    })
  })

  it("rejects invalid token limits", () => {
    const form = base()
    form.models[0].contextLimit = "1.5"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].contextLimit).toBe("provider.custom.error.tokenLimit")
  })

  it("rejects zero token limits", () => {
    const form = base()
    form.models[0].contextLimit = "0"
    form.models[0].outputLimit = "8192"
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeUndefined()
    expect(out.errors.models[0].contextLimit).toBe("provider.custom.error.tokenLimit")
  })

  it("serializes image modality when supportsImages is set", () => {
    const form = base()
    form.models[0].supportsImages = true
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text", "image"] })
  })

  it("omits modalities when supportsImages is not set on a text-only model", () => {
    const form = base()
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toBeUndefined()
  })

  it("preserves an existing image-only input when saving", () => {
    const form = base()
    form.models[0].modalities = { input: ["image"] }
    form.models[0].supportsImages = true
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["image"] })
  })

  it("omits an empty input when image support is removed from an image-only model", () => {
    const form = base()
    form.models[0].modalities = { input: ["image"] }
    form.models[0].supportsImages = false
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toBeUndefined()
  })

  it("preserves output-only modalities when saving", () => {
    const form = base()
    form.models[0].modalities = { output: ["audio"] }
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ output: ["audio"] })
  })

  it("preserves unsupported UI modalities when toggling image support", () => {
    const form = base()
    form.models[0].modalities = {
      input: ["text", "audio", "image", "video", "pdf"],
      output: ["text", "audio"],
    }
    form.models[0].supportsImages = false
    const out = validateCustomProvider(args(form))
    expect(out.result).toBeDefined()
    const saved = out.result!.config.models["model-1"] as Record<string, unknown>
    expect(saved.modalities).toEqual({ input: ["text", "audio", "video", "pdf"], output: ["text", "audio"] })
  })
})
