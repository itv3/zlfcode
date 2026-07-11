import { describe, expect, it } from "bun:test"
import { prioritizeVariants } from "../../webview-ui/src/components/settings/CustomProviderVariants"
import type { VariantEntry } from "../../webview-ui/src/components/settings/CustomProviderModelCard"
import { validateCustomProvider } from "../../webview-ui/src/components/settings/CustomProviderValidation"
import type { FormState } from "../../webview-ui/src/components/settings/CustomProviderValidation"

function item(name: string): VariantEntry {
  return {
    name,
    enableThinking: undefined,
    thinking: undefined,
    splitReasoning: undefined,
    reasoningEffort: name as VariantEntry["reasoningEffort"],
    outputEffort: undefined,
    chatTemplateArgs: undefined,
  }
}

function save(variants: VariantEntry[]) {
  const form: FormState = {
    providerID: "provider-13",
    name: "Provider 13",
    npm: "@ai-sdk/openai-compatible",
    baseURL: "https://example.com/v1",
    apiKey: "",
    models: [
      {
        id: "gpt-5.6-sol",
        name: "gpt-5.6-sol",
        supportsImages: true,
        modalities: {},
        contextLimit: "1050000",
        outputLimit: "128000",
        costEnabled: false,
        inputCost: "",
        outputCost: "",
        cacheReadCost: "",
        cacheWriteCost: "",
        reasoning: true,
        variants,
      },
    ],
    headers: [],
    saving: false,
  }
  const out = validateCustomProvider({
    form,
    t: (key) => key,
    editing: false,
    disabledProviders: [],
    existingProviderIDs: new Set(),
  })
  expect(out.result).toBeDefined()
  return (out.result!.config.models["gpt-5.6-sol"] as { variants: Record<string, unknown> }).variants
}

describe("prioritizeVariants", () => {
  it("moves the selected variant to the front", () => {
    const variants = ["high", "max", "low", "medium", "xhigh"].map(item)

    const result = prioritizeVariants(variants, "low")

    expect(result.map((entry) => entry.name)).toEqual(["low", "high", "max", "medium", "xhigh"])
  })

  it("keeps the current order when the selected variant is already first", () => {
    const variants = ["low", "medium", "high"].map(item)

    const result = prioritizeVariants(variants, "low")

    expect(result).toBe(variants)
    expect(result.map((entry) => entry.name)).toEqual(["low", "medium", "high"])
  })

  it("does not create a reactive update when the selected variant is missing", () => {
    const variants = ["none", "low", "medium"].map(item)

    const result = prioritizeVariants(variants, "max")

    expect(result).toBe(variants)
  })

  it("updates the default variant immediately after selecting Max from candidate defaults", () => {
    const variants = ["none", "low", "medium", "high", "xhigh", "max"].map(item)

    expect(variants[0]?.name).toBe("none")

    const result = prioritizeVariants(variants, "max")

    expect(result).not.toBe(variants)
    expect(result[0]?.name).toBe("max")
    expect(Object.keys(save(result))[0]).toBe("max")
  })

  it("updates and serializes every consecutive default variant selection", () => {
    const selected = ["xhigh", "low", "medium", "high", "none"]
    let variants = ["none", "low", "medium", "high", "xhigh", "max"].map(item)

    for (const name of selected) {
      variants = prioritizeVariants(variants, name)
      expect(variants[0]?.name).toBe(name)
      expect(Object.keys(save(variants))[0]).toBe(name)
    }
  })
})
