import { describe, expect, it } from "bun:test"
import path from "node:path"
import {
  defaultCandidates,
  defaultKeys,
  defaultsForModel,
  mergeModelDefaults,
  parseDefaults,
  replaceModelDefaults,
} from "../../webview-ui/src/components/settings/CustomProviderDefaults"
import {
  customProviderCatalog,
  customProviderProtocol,
  normalizeCustomProviderBaseURL,
} from "../../src/shared/provider-model"
import type { ModelEntry } from "../../webview-ui/src/components/settings/CustomProviderModelCard"
import type { Provider } from "../../webview-ui/src/types/messages"

function providers(): Record<string, Provider> {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {},
    },
    "alibaba-token-plan": {
      id: "alibaba-token-plan",
      name: "Alibaba Token Plan",
      models: {
        "glm-5.2": {
          id: "glm-5.2",
          name: "GLM-5.2",
          capabilities: {
            reasoning: true,
            input: { text: true, image: false, audio: false, video: false, pdf: false },
          },
          limit: { context: 1000000, output: 131072 },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        },
      },
    },
    zhipuai: {
      id: "zhipuai",
      name: "ZhipuAI",
      models: {
        "glm-5.2": {
          id: "glm-5.2",
          name: "GLM-5.2",
          capabilities: {
            reasoning: true,
            input: { text: true, image: false, audio: false, video: false, pdf: false },
          },
          limit: { context: 1000000, output: 131072 },
          cost: { input: 1.4, output: 4.4, cache: { read: 0.26, write: 0 } },
          variants: {
            max: { reasoningEffort: "max" },
            high: { reasoningEffort: "high" },
          },
        },
      },
    },
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-opus-4-6": {
          id: "claude-opus-4-6",
          name: "Claude Opus 4.6",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: false, video: false, pdf: false },
          },
          limit: { context: 200000, output: 32000 },
          cost: { input: 15, output: 75, cache: { read: 1.5, write: 18.75 } },
          variants: {
            low: { thinking: { type: "adaptive" }, effort: "low" },
            medium: { thinking: { type: "adaptive" }, effort: "medium" },
            high: { thinking: { type: "adaptive" }, effort: "high" },
            xhigh: { thinking: { type: "adaptive" }, effort: "xhigh" },
            max: { thinking: { type: "adaptive" }, effort: "max" },
          },
        },
        "claude-opus-4-7": {
          id: "claude-opus-4-7",
          name: "Claude Opus 4.7",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: false, video: false, pdf: false },
          },
          limit: { context: 200000, output: 64000 },
          cost: { input: 20, output: 100, cache: { read: 2, write: 25 } },
          variants: {
            high: { thinking: { type: "adaptive" }, effort: "high" },
            max: { thinking: { type: "adaptive" }, effort: "max" },
          },
        },
      },
    },
    google: {
      id: "google",
      name: "Google",
      models: {
        "gemini-3.1-pro-preview": {
          id: "gemini-3.1-pro-preview",
          name: "Gemini 3.1 Pro Preview",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: true, video: true, pdf: true },
          },
          limit: { context: 1048576, output: 65536 },
          cost: { input: 2, output: 12, cache: { read: 0.2, write: 0 } },
        },
      },
    },
    opencode: {
      id: "opencode",
      name: "OpenCode",
      models: {
        "gemini-3.1-pro": {
          id: "gemini-3.1-pro",
          name: "Gemini 3.1 Pro Preview",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: true, video: true, pdf: true },
          },
          limit: { context: 1048576, output: 65536 },
          cost: { input: 2, output: 12, cache: { read: 0.2, write: 0 } },
        },
      },
    },
    openrouter: {
      id: "openrouter",
      name: "OpenRouter",
      models: {
        "anthropic/claude-opus-4-6": {
          id: "anthropic/claude-opus-4-6",
          name: "Claude Opus 4.6",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: false, video: false, pdf: true },
          },
          limit: { context: 200000, output: 32000 },
          cost: { input: 15, output: 75, cache: { read: 1.5, write: 18.75 } },
        },
      },
    },
    "nano-gpt": {
      id: "nano-gpt",
      name: "Nano GPT",
      models: {
        "google/gemini-3.1-pro-preview-low": {
          id: "google/gemini-3.1-pro-preview-low",
          name: "Gemini 3.1 Pro (Preview Low)",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: false, video: false, pdf: false },
          },
          limit: { context: 1048756, input: 1048756, output: 65536 },
          cost: { input: 2, output: 12, cache: { read: 0.2, write: 0 } },
        },
      },
    },
    "3ab_antigravity": {
      id: "3ab_antigravity",
      name: "3AB Antigravity",
      models: {
        "gemini-3.1-pro-low": {
          id: "gemini-3.1-pro-low",
          name: "Gemini 3.1 Pro Low",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: false, video: false, pdf: false },
          },
          limit: { context: 111, output: 222 },
          cost: { input: 3, output: 4, cache: { read: 5, write: 6 } },
        },
      },
    },
    "302ai": {
      id: "302ai",
      name: "302AI",
      models: {
        "claude-opus-4-6-thinking": {
          id: "claude-opus-4-6-thinking",
          name: "Claude Opus 4.6 Thinking",
          capabilities: {
            reasoning: true,
            input: { text: true, image: true, audio: false, video: false, pdf: false },
          },
          limit: { context: 200000, output: 32000 },
          cost: { input: 15, output: 75, cache: { read: 1.5, write: 18.75 } },
        },
      },
    },
  }
}

describe("custom provider default matching", () => {
  it("keeps package protocol, catalog, and base URL metadata in one mapping", () => {
    expect(customProviderProtocol("@ai-sdk/openai-compatible")).toBe("openai")
    expect(customProviderCatalog("@ai-sdk/openai-compatible")).toBe("openai")
    expect(customProviderProtocol("@ai-sdk/anthropic")).toBe("anthropic")
    expect(customProviderCatalog("@ai-sdk/anthropic")).toBe("anthropic")
    expect(normalizeCustomProviderBaseURL("@ai-sdk/anthropic", "https://api.anthropic.com")).toBe(
      "https://api.anthropic.com/v1",
    )
    expect(customProviderProtocol("@ai-sdk/google")).toBe("gemini")
    expect(customProviderCatalog("@ai-sdk/google")).toBe("google")
    expect(normalizeCustomProviderBaseURL("@ai-sdk/google", "https://generativelanguage.googleapis.com")).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    )
  })

  it("does not silently match thinking suffix models against the base catalog model", () => {
    const out = defaultsForModel(providers(), "@ai-sdk/anthropic", "claude-opus-4-6-thinking")

    expect(out).toEqual({})

    const items = defaultCandidates(providers(), "@ai-sdk/anthropic", "claude-opus-4-6-thinking")
    const item = items.find((item) => item.providerID === "anthropic" && item.modelID === "claude-opus-4-6")
    expect(item?.defaults.contextLimit).toBe(200000)
  })

  it("does not silently match exact IDs from discovered providers outside the scoped defaults list", () => {
    const out = defaultsForModel(providers(), "@ai-sdk/openai-compatible", "claude-opus-4-6-thinking")

    expect(out).toEqual({})

    const items = defaultCandidates(providers(), "@ai-sdk/openai-compatible", "claude-opus-4-6-thinking")
    expect(items.map((item) => `${item.providerID}/${item.modelID}`)).toContain("302ai/claude-opus-4-6-thinking")
  })

  it("keeps exact model IDs in the candidate list for manual selection", () => {
    const items = defaultCandidates(providers(), "@ai-sdk/openai-compatible", "claude-opus-4-6")

    expect(items.map((item) => `${item.providerID}/${item.modelID}`)).toContain("anthropic/claude-opus-4-6")
    expect(items.map((item) => `${item.providerID}/${item.modelID}`)).toContain("openrouter/anthropic/claude-opus-4-6")
  })

  it("falls back across providers and matches IDs case-insensitively", () => {
    const out = defaultsForModel(providers(), "@ai-sdk/openai-compatible", "GLM-5.2")

    expect(out.reasoning).toBe(true)
    expect(out.contextLimit).toBe(1000000)
    expect(out.outputLimit).toBe(131072)
    expect(out.inputCost).toBe(1.4)
    expect(out.outputCost).toBe(4.4)
    expect(out.cacheReadCost).toBe(0.26)
    expect(out.cacheWriteCost).toBe(0)
    expect(Object.keys(out.variants ?? {})).toEqual(["max", "high"])
  })

  it("merges catalog defaults into a fetched model", () => {
    const model: ModelEntry = {
      id: "GLM-5.2",
      name: "GLM-5.2",
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
    }

    const out = mergeModelDefaults(model, defaultsForModel(providers(), "@ai-sdk/openai-compatible", "GLM-5.2"))

    expect(out.reasoning).toBe(true)
    expect(out.contextLimit).toBe("1000000")
    expect(out.outputLimit).toBe("131072")
    expect(out.costEnabled).toBe(true)
    expect(out.inputCost).toBe("1.4")
    expect(out.outputCost).toBe("4.4")
    expect(out.cacheReadCost).toBe("0.26")
    expect(out.cacheWriteCost).toBe("0")
    expect(out.variants.map((item) => [item.name, item.reasoningEffort])).toEqual([
      ["max", "max"],
      ["high", "high"],
    ])
  })

  it("does not overwrite fields already set on a fetched model", () => {
    const model: ModelEntry = {
      id: "GLM-5.2",
      name: "Custom GLM",
      supportsImages: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      contextLimit: "123",
      outputLimit: "456",
      costEnabled: true,
      inputCost: "7",
      outputCost: "8",
      cacheReadCost: "9",
      cacheWriteCost: "10",
      reasoning: true,
      variants: [
        {
          name: "custom",
          enableThinking: undefined,
          thinking: undefined,
          splitReasoning: undefined,
          reasoningEffort: "low",
          outputEffort: undefined,
          chatTemplateArgs: undefined,
        },
      ],
    }

    const out = mergeModelDefaults(model, defaultsForModel(providers(), "@ai-sdk/openai-compatible", "GLM-5.2"))

    expect(out).toEqual(model)
  })

  it("replaces inferred defaults when a candidate is selected", () => {
    const model: ModelEntry = {
      id: "gpt-5.6-sol",
      name: "gpt-5.6-sol",
      supportsImages: false,
      modalities: { input: ["text"], output: ["text"] },
      contextLimit: "400000",
      outputLimit: "32000",
      costEnabled: false,
      inputCost: "",
      outputCost: "",
      cacheReadCost: "",
      cacheWriteCost: "",
      reasoning: true,
      variants: ["none", "low", "medium", "high", "xhigh"].map((name) => ({
        name,
        enableThinking: undefined,
        thinking: undefined,
        splitReasoning: undefined,
        reasoningEffort: name as "none" | "low" | "medium" | "high" | "xhigh",
        outputEffort: undefined,
        chatTemplateArgs: undefined,
      })),
    }

    const out = replaceModelDefaults(model, {
      image: true,
      reasoning: true,
      contextLimit: 1050000,
      outputLimit: 128000,
      inputCost: 5,
      outputCost: 30,
      cacheReadCost: 0.5,
      cacheWriteCost: 6.25,
      variants: {
        none: { reasoningEffort: "none" },
        low: { reasoningEffort: "low" },
        medium: { reasoningEffort: "medium" },
        high: { reasoningEffort: "high" },
        xhigh: { reasoningEffort: "xhigh" },
        max: { reasoningEffort: "max" },
      },
    })

    expect(out.id).toBe(model.id)
    expect(out.name).toBe(model.name)
    expect(out.supportsImages).toBe(true)
    expect(out.contextLimit).toBe("1050000")
    expect(out.outputLimit).toBe("128000")
    expect(out.costEnabled).toBe(true)
    expect(out.inputCost).toBe("5")
    expect(out.outputCost).toBe("30")
    expect(out.cacheReadCost).toBe("0.5")
    expect(out.cacheWriteCost).toBe("6.25")
    expect(out.variants.map((item) => [item.name, item.reasoningEffort])).toEqual([
      ["none", "none"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
      ["xhigh", "xhigh"],
      ["max", "max"],
    ])
  })

  it("preserves provider-native variant fields that the compact editor does not model", () => {
    const out = parseDefaults({
      variants: {
        xhigh: { reasoning: { effort: "xhigh" } },
        gemini: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
        claude: { thinking: { type: "adaptive", display: "summarized" }, effort: "high" },
      },
    })

    expect(out.map((item) => [item.name, item.extras, item.thinking, item.outputEffort])).toEqual([
      ["xhigh", { reasoning: { effort: "xhigh" } }, undefined, undefined],
      ["gemini", { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } }, undefined, undefined],
      ["claude", { thinking: { display: "summarized" } }, "adaptive", "high"],
    ])
  })

  it("keeps explicit fallback keys without removing variant suffixes", () => {
    expect(defaultKeys("anthropic/claude-opus-4-8-thinking")).toEqual([
      "anthropic/claude-opus-4-8-thinking",
      "claude-opus-4-8-thinking",
    ])
  })

  it("suggests nearby model defaults when variant-like IDs do not match exactly", () => {
    const pool = providers()
    delete pool["3ab_antigravity"]
    const exact = defaultsForModel(pool, "@ai-sdk/openai-compatible", "gemini-3.1-pro-low")
    expect(exact).toEqual({})

    const items = defaultCandidates(pool, "@ai-sdk/openai-compatible", "gemini-3.1-pro-low")

    expect(items.map((item) => `${item.providerID}/${item.modelID}`).slice(0, 3)).toEqual([
      "nano-gpt/google/gemini-3.1-pro-preview-low",
      "opencode/gemini-3.1-pro",
      "google/gemini-3.1-pro-preview",
    ])
    expect(items[0]?.defaults.contextLimit).toBe(1048756)
    expect(items[0]?.defaults.reasoning).toBe(true)
  })

  it("includes candidate-specific reasoning variants in defaults", () => {
    const items = defaultCandidates(providers(), "@ai-sdk/openai-compatible", "claude-opus-4-6-thinking")
    const item = items.find((item) => item.providerID === "anthropic" && item.modelID === "claude-opus-4-6")

    expect(Object.keys(item?.defaults.variants ?? {})).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  it("excludes the custom provider being edited from nearby default candidates", () => {
    const items = defaultCandidates(providers(), "@ai-sdk/openai-compatible", "gemini-3-pro-low", 5, {
      excludeProviders: ["3ab_antigravity"],
      excludeModels: ["gemini-3-pro-low"],
    })

    expect(items.map((item) => `${item.providerID}/${item.modelID}`)).not.toContain(
      "3ab_antigravity/gemini-3.1-pro-low",
    )
    expect(items[0]?.providerID).toBe("nano-gpt")
  })

  it("recomputes the current suggestion when the complete provider catalog arrives", () => {
    const webview = path.resolve(import.meta.dir, "../../webview-ui")
    const script = `
      const { createMemo, createRoot, createSignal } = await import("solid-js")
      const { resolveSuggestion } = await import("./src/components/settings/CustomProviderDefaults.ts")
      const entry = (id, name) => ({
        id,
        name,
        capabilities: {
          reasoning: true,
          input: { text: true, image: true, audio: false, video: false, pdf: true },
        },
        limit: { context: 1050000, output: 128000 },
        cost: { input: 5, output: 30, cache: { read: 0.5, write: 6.25 } },
        variants: {
          none: { reasoningEffort: "none" },
          low: { reasoningEffort: "low" },
          medium: { reasoningEffort: "medium" },
          high: { reasoningEffort: "high" },
          xhigh: { reasoningEffort: "xhigh" },
          max: { reasoningEffort: "max" },
        },
      })
      const connected = {
        kilo: {
          id: "kilo",
          name: "Kilo Gateway",
          models: {
            "openai/gpt-5.6-sol": entry("openai/gpt-5.6-sol", "OpenAI: GPT-5.6 Sol (new)"),
            "openai/gpt-5.6-sol-pro": entry("openai/gpt-5.6-sol-pro", "OpenAI: GPT-5.6 Sol Pro"),
          },
        },
        "13": {
          id: "13",
          name: "Provider 13",
          models: { "gpt-5.6-sol": entry("gpt-5.6-sol", "gpt-5.6-sol") },
        },
      }
      const full = {
        ...connected,
        openai: {
          id: "openai",
          name: "OpenAI",
          models: { "gpt-5.6-sol": entry("gpt-5.6-sol", "GPT-5.6 Sol") },
        },
        llmgateway: {
          id: "llmgateway",
          name: "LLMGateway",
          models: { "gpt-5.6-sol": entry("gpt-5.6-sol", "GPT-5.6 Sol") },
        },
      }
      const fail = (message) => {
        console.error(message)
        process.exit(1)
      }

      createRoot((dispose) => {
        const [catalog, update] = createSignal(connected)
        const suggestion = { index: 0, id: "gpt-5.6-sol" }
        const current = createMemo(() =>
          resolveSuggestion(catalog(), "@ai-sdk/openai-compatible", suggestion, 5, {
            excludeProviders: ["13"],
          }),
        )
        const ids = () => current()?.items.map((item) => item.providerID + "/" + item.modelID) ?? []

        if (ids().join(",") !== "kilo/openai/gpt-5.6-sol,kilo/openai/gpt-5.6-sol-pro") {
          fail("connected 快照候选不符合预期: " + ids().join(","))
        }

        update(full)

        if (ids().slice(0, 2).join(",") !== "openai/gpt-5.6-sol,llmgateway/gpt-5.6-sol") {
          fail("完整 catalog 到达后候选没有重算: " + ids().join(","))
        }
        if (current()?.items.some((item) => item.providerID === "13")) fail("候选包含正在编辑的 Provider")
        if (!Object.hasOwn(current()?.items[0]?.defaults.variants ?? {}, "max")) fail("Max 变体丢失")
        dispose()
      })
    `
    const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", script], {
      cwd: webview,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = result.stdout.toString() + result.stderr.toString()

    expect(result.exitCode, output).toBe(0)
  })
})
