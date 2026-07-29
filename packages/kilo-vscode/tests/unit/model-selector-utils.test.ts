import { describe, it, expect } from "bun:test"
import { readFileSync as fsReadFileSync } from "node:fs"
import { join as pathJoin } from "node:path"
import {
  providerSortKey,
  buildTriggerLabel,
  stripSubProviderPrefix,
  sanitizeName,
  KILO_GATEWAY_ID,
  PROVIDER_ORDER,
  freeDataLabel,
  isDataCollectedModel,
  hasByok,
  isFree,
  isAuto,
  autoSummary,
  autoChoices,
  isSmall,
  KILO_AUTO_SMALL_IDS,
} from "../../webview-ui/src/components/shared/model-selector-utils"

const labels = { select: "Select model", noProviders: "No providers", notSet: "Not set" }

describe("providerSortKey", () => {
  it("returns 0 for kilo gateway", () => {
    expect(providerSortKey(KILO_GATEWAY_ID)).toBe(0)
  })

  it("returns correct index for known providers", () => {
    expect(providerSortKey("anthropic")).toBe(1)
    expect(providerSortKey("openai")).toBe(3)
    expect(providerSortKey("google")).toBe(4)
  })

  it("returns order length for unknown provider", () => {
    expect(providerSortKey("unknown-provider")).toBe(PROVIDER_ORDER.length)
  })

  it("is case-insensitive", () => {
    expect(providerSortKey("Anthropic")).toBe(providerSortKey("anthropic"))
    expect(providerSortKey("OpenAI")).toBe(providerSortKey("openai"))
  })

  it("respects custom order array", () => {
    const order = ["z-provider", "a-provider"]
    expect(providerSortKey("z-provider", order)).toBe(0)
    expect(providerSortKey("a-provider", order)).toBe(1)
    expect(providerSortKey("other", order)).toBe(2)
  })

  it("sorts providers correctly when used with sort", () => {
    const ids = ["google", "anthropic", "kilo", "openai", "deepseek"]
    const sorted = ids.slice().sort((a, b) => providerSortKey(a) - providerSortKey(b))
    expect(sorted).toEqual(["kilo", "anthropic", "deepseek", "openai", "google"])
  })
})

describe("stripSubProviderPrefix", () => {
  it("strips prefix before ': '", () => {
    expect(stripSubProviderPrefix("Anthropic: Claude Sonnet")).toBe("Claude Sonnet")
    expect(stripSubProviderPrefix("OpenAI: GPT-4o")).toBe("GPT-4o")
  })

  it("leaves names without ': ' unchanged", () => {
    expect(stripSubProviderPrefix("GPT-4o")).toBe("GPT-4o")
    expect(stripSubProviderPrefix("claude-3-5-sonnet")).toBe("claude-3-5-sonnet")
  })

  it("does not strip 'Kilo: ' prefix", () => {
    expect(stripSubProviderPrefix("Kilo: Auto")).toBe("Kilo: Auto")
    expect(stripSubProviderPrefix("kilo: Auto")).toBe("kilo: Auto")
  })
})

describe("sanitizeName", () => {
  it("strips trailing (free) suffix", () => {
    expect(sanitizeName("Llama 3 (free)")).toBe("Llama 3")
  })

  it("is case-insensitive for parenthesized suffix", () => {
    expect(sanitizeName("Model (Free)")).toBe("Model")
    expect(sanitizeName("Model (FREE)")).toBe("Model")
  })

  it("preserves bare trailing Free in names like 'Kilo Auto Free'", () => {
    expect(sanitizeName("Kilo Auto Free")).toBe("Kilo Auto Free")
    expect(sanitizeName("Mixtral free")).toBe("Mixtral free")
    expect(sanitizeName("Mistral:free")).toBe("Mistral:free")
    expect(sanitizeName("Gemma-free")).toBe("Gemma-free")
    expect(sanitizeName("Model FREE")).toBe("Model FREE")
  })

  it("leaves names without (free) suffix unchanged", () => {
    expect(sanitizeName("GPT-4o")).toBe("GPT-4o")
    expect(sanitizeName("Claude Sonnet")).toBe("Claude Sonnet")
  })

  it("does not strip 'free' from the middle of a name", () => {
    expect(sanitizeName("FreeAgent Pro")).toBe("FreeAgent Pro")
  })

  it("handles extra whitespace around (free) suffix", () => {
    expect(sanitizeName("Llama 3 (free)  ")).toBe("Llama 3")
    expect(sanitizeName("Model  (free)  ")).toBe("Model")
  })
})

describe("freeDataLabel", () => {
  it("uses the data collection label without repeating free", () => {
    expect(freeDataLabel("Free", "Data may be used for training")).toBe("Data may be used for training")
  })
})

describe("isFree", () => {
  it("uses only explicit free metadata", () => {
    expect(isFree({ isFree: true })).toBe(true)
    expect(isFree({ isFree: false })).toBe(false)
    expect(isFree({})).toBe(false)
  })
})

describe("isAuto", () => {
  it("matches only Kilo Auto model ids", () => {
    expect(isAuto({ providerID: KILO_GATEWAY_ID, id: "kilo-auto/efficient" })).toBe(true)
    expect(isAuto({ providerID: KILO_GATEWAY_ID, id: "auto-small" })).toBe(true)
    expect(isAuto({ providerID: "anthropic", id: "kilo-auto/efficient" })).toBe(false)
    expect(isAuto({ providerID: KILO_GATEWAY_ID, id: "anthropic/claude-sonnet" })).toBe(false)
  })
})

describe("autoChoices", () => {
  it("uses backend Auto Efficient routes and resolves names when available", () => {
    expect(
      autoChoices(
        {
          providerID: KILO_GATEWAY_ID,
          id: "kilo-auto/efficient",
          autoRouting: { models: ["provider/model", "missing/model"] },
        },
        [{ id: "provider/model", name: "Provider: Model" }],
      ),
    ).toEqual([
      { id: "provider/model", name: "Model" },
      { id: "missing/model", name: "missing/model" },
    ])
  })

  it("ignores missing routes and non-efficient Auto models", () => {
    expect(autoChoices({ providerID: KILO_GATEWAY_ID, id: "kilo-auto/efficient" })).toEqual([])
    expect(
      autoChoices({
        providerID: KILO_GATEWAY_ID,
        id: "kilo-auto/frontier",
        autoRouting: { models: ["provider/model"] },
      }),
    ).toEqual([])
  })
})

describe("autoSummary", () => {
  it("uses the first description paragraph for compact tooltips", () => {
    expect(
      autoSummary({
        options: {
          description: "Routes through available models.\n\nLong details.",
        },
      }),
    ).toBe("Routes through available models.")
  })

  it("falls back when there is no description", () => {
    expect(autoSummary({})).toBe("Routes requests automatically.")
  })
})

describe("isDataCollectedModel", () => {
  it("uses only explicit prompt training metadata", () => {
    expect(isDataCollectedModel({ mayTrainOnYourPrompts: true })).toBe(true)
    expect(isDataCollectedModel({ mayTrainOnYourPrompts: false })).toBe(false)
    expect(isDataCollectedModel({})).toBe(false)
  })
})

describe("hasByok", () => {
  it("uses only explicit user BYOK metadata", () => {
    expect(hasByok({ hasUserByokAvailable: true })).toBe(true)
    expect(hasByok({ hasUserByokAvailable: false })).toBe(false)
    expect(hasByok({})).toBe(false)
  })
})

describe("isSmall", () => {
  // isSmall / KILO_AUTO_SMALL_IDS 的实现已下沉到 src/shared/provider-model.ts，
  // 此处经 model-selector-utils 的 re-export 路径验证导出兼容与行为不变。
  it("matches only Kilo gateway auto-small ids", () => {
    expect(isSmall({ providerID: KILO_GATEWAY_ID, id: "kilo-auto/small" })).toBe(true)
    expect(isSmall({ providerID: KILO_GATEWAY_ID, id: "auto-small" })).toBe(true)
    expect(isSmall({ providerID: KILO_GATEWAY_ID, id: "kilo-auto/free" })).toBe(false)
    expect(isSmall({ providerID: "openai", id: "kilo-auto/small" })).toBe(false)
  })

  it("keeps the exported id set in sync with isSmall", () => {
    for (const id of KILO_AUTO_SMALL_IDS) {
      expect(isSmall({ providerID: KILO_GATEWAY_ID, id })).toBe(true)
    }
  })
})

describe("buildTriggerLabel", () => {
  it("returns resolved model name for non-kilo provider unchanged", () => {
    expect(buildTriggerLabel("GPT-4o", "openai", undefined, null, false, "", true, labels)).toBe("GPT-4o")
  })

  it("strips sub-provider prefix from resolved name for kilo gateway models", () => {
    expect(
      buildTriggerLabel("Anthropic: Claude Sonnet", KILO_GATEWAY_ID, undefined, null, false, "", true, labels),
    ).toBe("Claude Sonnet")
  })

  it("does not strip prefix for non-kilo provider even if name contains ': '", () => {
    expect(buildTriggerLabel("Anthropic: Claude Sonnet", "anthropic", undefined, null, false, "", true, labels)).toBe(
      "Anthropic: Claude Sonnet",
    )
  })

  it("returns resolved name as-is when providerID is undefined", () => {
    expect(buildTriggerLabel("GPT-4o", undefined, undefined, null, false, "", true, labels)).toBe("GPT-4o")
  })

  it("returns providerName / resolvedName for non-kilo provider with providerName", () => {
    expect(buildTriggerLabel("GPT-4o", "openai", "OpenAI", null, false, "", true, labels)).toBe("OpenAI / GPT-4o")
  })

  it("returns modelID for kilo gateway raw selection", () => {
    const raw = { providerID: "kilo", modelID: "kilo-auto/frontier" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", false, labels)).toBe("kilo-auto/frontier")
  })

  it("returns providerID / modelID for non-kilo raw selection", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", false, labels)).toBe(
      "anthropic / claude-3-5-sonnet",
    )
  })

  it("returns clearLabel when allowClear and no selection", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, true, "None", true, labels)).toBe("None")
  })

  it("falls back to labels.notSet when allowClear and clearLabel is empty", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, true, "", true, labels)).toBe("Not set")
  })

  it("returns labels.select when providers exist and no selection", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, false, "", true, labels)).toBe("Select model")
  })

  it("returns labels.noProviders when no providers available", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, false, "", false, labels)).toBe("No providers")
  })

  it("prefers resolvedName over raw selection", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel("Claude Sonnet", undefined, undefined, raw, false, "", true, labels)).toBe("Claude Sonnet")
  })

  // 默认语义＝"configured"（上游 v7.4.16 的原始行为，F65）：不传语义参数的
  // 调用（例如未来上游合并新增的调用点）保持 raw 兜底显示，不被本 fork 的
  // 语义收窄静默影响。
  it("defaults to the upstream configured semantics when the parameter is omitted (F65)", () => {
    const raw = { providerID: "sg", modelID: "gpt-5.5" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels)).toBe("sg / gpt-5.5")
  })

  // "resolved" 语义（聊天选择器，显式传入）：providers 加载完成后仍无法解析的
  // raw 选择会被模型回退逻辑忽略，因此不显示 raw 兜底。
  it("ignores unresolved raw selection after providers are available (explicit resolved semantics)", () => {
    const raw = { providerID: "sg", modelID: "gpt-5.5" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels, "resolved")).toBe(
      "Select model",
    )
  })

  // "configured" 语义（设置页）：展示的是配置值本身。即使 providers 已加载而
  // 选择不可解析（provider 未连接等），也要按上游行为原样显示配置值，
  // 不能落入 allowClear 分支显示 "Not set" 掩盖真实配置状态。
  it("keeps unresolved raw selection visible with configured semantics", () => {
    const raw = { providerID: "sg", modelID: "gpt-5.5" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels, "configured")).toBe(
      "sg / gpt-5.5",
    )
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, true, "Not set", true, labels, "configured")).toBe(
      "sg / gpt-5.5",
    )
  })

  it("shows only the model id for unresolved kilo raw selection with configured semantics", () => {
    const raw = { providerID: KILO_GATEWAY_ID, modelID: "anthropic/claude-sonnet" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, true, "Not set", true, labels, "configured")).toBe(
      "anthropic/claude-sonnet",
    )
  })

  it("still falls back to clearLabel with configured semantics when nothing is configured", () => {
    expect(buildTriggerLabel(undefined, undefined, undefined, null, true, "Not set", true, labels, "configured")).toBe(
      "Not set",
    )
  })

  it("prefers resolved name over raw with configured semantics", () => {
    const raw = { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
    expect(
      buildTriggerLabel("Claude Sonnet", "anthropic", "Anthropic", raw, true, "Not set", true, labels, "configured"),
    ).toBe("Anthropic / Claude Sonnet")
  })

  it("ignores partial raw selection (only providerID)", () => {
    const raw = { providerID: "anthropic", modelID: "" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels)).toBe("Select model")
  })

  it("ignores partial raw selection (only modelID)", () => {
    const raw = { providerID: "", modelID: "claude-3-5-sonnet" }
    expect(buildTriggerLabel(undefined, undefined, undefined, raw, false, "", true, labels)).toBe("Select model")
  })
})

// ── F65 源码守卫 ────────────────────────────────────────────────────────────
// buildTriggerLabel/ModelSelectorBase 的默认语义是 "configured"（上游行为），
// "resolved" 收窄必须由聊天路径显式声明。此守卫防止上游三方合并时丢失显式
// 传参导致聊天选择器静默回到 raw 兜底显示。
describe("chat-path labelSemantics guard (F65)", () => {
  const read = (rel: string) => fsReadFileSync(pathJoin(import.meta.dir, "../../webview-ui", rel), "utf8")

  it("chat ModelSelector and NewWorktreeDialog explicitly pass resolved semantics", () => {
    expect(read("src/components/shared/ModelSelector.tsx")).toContain('labelSemantics="resolved"')
    expect(read("agent-manager/NewWorktreeDialog.tsx")).toContain('labelSemantics="resolved"')
  })

  it("ModelSelectorBase falls back to the upstream configured semantics", () => {
    expect(read("src/components/shared/ModelSelector.tsx")).toContain('props.labelSemantics ?? "configured"')
  })
})
