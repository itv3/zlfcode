import { describe, expect, it } from "bun:test"
import { prioritizeVariants } from "../../webview-ui/src/components/settings/CustomProviderVariants"
import type { VariantEntry } from "../../webview-ui/src/components/settings/CustomProviderModelCard"

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

describe("prioritizeVariants", () => {
  it("moves the selected variant to the front", () => {
    const variants = ["high", "max", "low", "medium", "xhigh"].map(item)

    const result = prioritizeVariants(variants, "low")

    expect(result.map((entry) => entry.name)).toEqual(["low", "high", "max", "medium", "xhigh"])
  })

  it("keeps the current order when the selected variant is already first", () => {
    const variants = ["low", "medium", "high"].map(item)

    const result = prioritizeVariants(variants, "low")

    expect(result.map((entry) => entry.name)).toEqual(["low", "medium", "high"])
  })
})
