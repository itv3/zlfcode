import { describe, expect, it } from "bun:test"
import {
  MASKED_CUSTOM_PROVIDER_KEY,
  customProviderConfigPatches,
  parseCustomProviderSecret,
  resolveCustomProviderKey,
  resolveCustomProviderAuth,
  sanitizeCustomProviderConfig,
  validateProviderID,
  providerReset,
  withCustomProviderDeletions,
} from "../../src/shared/custom-provider"
import { isCustomProviderPackage } from "../../src/shared/provider-model"

describe("isCustomProviderPackage", () => {
  it("recognizes supported custom provider packages", () => {
    expect(isCustomProviderPackage("@ai-sdk/openai-compatible")).toBe(true)
    expect(isCustomProviderPackage("@ai-sdk/openai")).toBe(true)
    expect(isCustomProviderPackage("@ai-sdk/anthropic")).toBe(true)
    expect(isCustomProviderPackage("@ai-sdk/google")).toBe(true)
    expect(isCustomProviderPackage("malicious-package")).toBe(false)
  })
})

describe("validateProviderID", () => {
  it("accepts valid provider ids", () => {
    expect(validateProviderID(" my-provider_1 ")).toEqual({ value: "my-provider_1" })
  })

  it("rejects invalid provider ids", () => {
    const result = validateProviderID("bad/id")
    expect("error" in result ? result.error : "").toBe("Invalid provider ID")
  })
})

describe("parseCustomProviderSecret", () => {
  it("treats plain values as api keys", () => {
    expect(parseCustomProviderSecret(" sk-test ")).toEqual({ value: { apiKey: "sk-test" } })
  })

  it("parses env references", () => {
    expect(parseCustomProviderSecret(" {env:MY_PROVIDER_KEY} ")).toEqual({ value: { env: "MY_PROVIDER_KEY" } })
  })

  it("rejects invalid env references", () => {
    const result = parseCustomProviderSecret("{env:bad-name}")
    expect("error" in result ? result.error : "").toBe("Invalid environment variable name")
  })
})

describe("resolveCustomProviderAuth", () => {
  it("preserves auth when the api key field is unchanged", () => {
    expect(resolveCustomProviderAuth(undefined, false)).toEqual({ mode: "preserve" })
  })

  it("stores a changed api key", () => {
    expect(resolveCustomProviderAuth(" sk-test ", true)).toEqual({ mode: "set", key: "sk-test" })
  })

  it("clears auth when the field was changed to empty", () => {
    expect(resolveCustomProviderAuth(undefined, true)).toEqual({ mode: "clear" })
  })
})

describe("resolveCustomProviderKey", () => {
  it("returns a masked value for api-backed providers", () => {
    expect(resolveCustomProviderKey("api")).toBe(MASKED_CUSTOM_PROVIDER_KEY)
  })

  it("hides non-api auth from the edit form", () => {
    expect(resolveCustomProviderKey("oauth")).toBe("")
  })

  it("returns empty when there is no saved key", () => {
    expect(resolveCustomProviderKey(undefined)).toBe("")
  })
})

describe("sanitizeCustomProviderConfig", () => {
  it("normalizes config and preserves an approved package", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "@ai-sdk/anthropic",
      name: " My Provider ",
      env: [" MY_PROVIDER_KEY "],
      options: {
        baseURL: "https://example.com/v1 ",
        headers: {
          Authorization: " Bearer test ",
          " X-Test ": " 123 ",
        },
      },
      models: {
        " model-1 ": { name: " Model One " },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/anthropic",
        name: "My Provider",
        env: ["MY_PROVIDER_KEY"],
        options: {
          baseURL: "https://example.com/v1",
          headers: {
            Authorization: "Bearer test",
            "X-Test": "123",
          },
        },
        models: {
          "model-1": { name: "Model One" },
        },
      },
    })
  })

  it("preserves the WebSocket option for OpenAI Responses providers", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "@ai-sdk/openai",
      name: "Responses Provider",
      options: {
        baseURL: "https://example.com/v1",
        websocket: true,
      },
      models: {
        "gpt-5": { name: "GPT-5" },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai",
        name: "Responses Provider",
        options: {
          baseURL: "https://example.com/v1",
          websocket: true,
        },
        models: {
          "gpt-5": { name: "GPT-5" },
        },
      },
    })
  })

  it("preserves model modalities and token limits", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "@ai-sdk/google",
      name: "Gemini Provider",
      options: { baseURL: "https://generativelanguage.googleapis.com/v1beta" },
      models: {
        "gemini-2.5-pro": {
          name: "Gemini 2.5 Pro",
          modalities: { input: ["text", "image"], output: ["text"] },
          limit: { context: 1_048_576, output: 65_536 },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/google",
        name: "Gemini Provider",
        options: { baseURL: "https://generativelanguage.googleapis.com/v1beta" },
        models: {
          "gemini-2.5-pro": {
            name: "Gemini 2.5 Pro",
            modalities: { input: ["text", "image"], output: ["text"] },
            limit: { context: 1_048_576, output: 65_536 },
          },
        },
      },
    })
  })

  it("rejects zero token limits", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "@ai-sdk/openai-compatible",
      name: "Zero Limit Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          limit: { context: 0, output: 0 },
        },
      },
    })

    expect("error" in result).toBe(true)
  })

  it("preserves model costs", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "@ai-sdk/openai-compatible",
      name: "Priced Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "Priced Provider",
        options: { baseURL: "https://example.com/v1" },
        models: {
          "model-1": {
            name: "Model One",
            cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
          },
        },
      },
    })
  })

  it("rejects non-finite model costs", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "@ai-sdk/openai-compatible",
      name: "Priced Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          cost: { input: Infinity, output: 15 },
        },
      },
    })

    expect("error" in result).toBe(true)
  })

  it("rejects unapproved packages", () => {
    const result = sanitizeCustomProviderConfig({
      npm: "malicious-package",
      name: "Bad Provider",
      options: { baseURL: "https://example.com/v1" },
      models: { "model-1": { name: "Model One" } },
    })

    expect("error" in result ? result.error : "").toContain("Invalid enum value")
  })

  it("accepts supported thinking variant options", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Thinking Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          variants: {
            thinking: {
              thinking: { type: "adaptive" },
              reasoning_split: true,
              effort: "max",
              chat_template_args: { enable_thinking: true },
            },
          },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "Thinking Provider",
        options: { baseURL: "https://example.com/v1" },
        models: {
          "model-1": {
            name: "Model One",
            variants: {
              thinking: {
                thinking: { type: "adaptive" },
                reasoning_split: true,
                effort: "max",
                chat_template_args: { enable_thinking: true },
              },
            },
          },
        },
      },
    })
  })

  it("preserves provider-native variant fields through extension-side sanitization", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Native Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          variants: {
            xhigh: { reasoning: { effort: "xhigh" }, reasoningEffort: "high" },
            high: {
              thinking: { type: "adaptive", display: "summarized" },
              thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
            },
          },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "Native Provider",
        options: { baseURL: "https://example.com/v1" },
        models: {
          "model-1": {
            name: "Model One",
            variants: {
              xhigh: { reasoning: { effort: "xhigh" }, reasoningEffort: "high" },
              high: {
                thinking: { type: "adaptive", display: "summarized" },
                thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
              },
            },
          },
        },
      },
    })
  })

  it("preserves core custom model modalities", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Media Provider",
      options: { baseURL: "https://example.com/v1" },
      models: {
        "model-1": {
          name: "Model One",
          modalities: {
            input: ["text", "audio", "image", "video", "pdf"],
            output: ["text", "audio"],
          },
        },
      },
    })

    expect(result).toEqual({
      value: {
        npm: "@ai-sdk/openai-compatible",
        name: "Media Provider",
        options: { baseURL: "https://example.com/v1" },
        models: {
          "model-1": {
            name: "Model One",
            modalities: {
              input: ["text", "audio", "image", "video", "pdf"],
              output: ["text", "audio"],
            },
          },
        },
      },
    })
  })

  it("rejects unknown fields", () => {
    const result = sanitizeCustomProviderConfig({
      name: "Bad Provider",
      options: {
        baseURL: "https://example.com/v1",
        mcpServer: "https://malicious.example",
      },
      models: { "model-1": { name: "Model One" } },
    })

    expect("error" in result ? result.error : "").toContain("mcpServer")
  })
})

describe("providerReset", () => {
  const next = {
    npm: "@ai-sdk/openai-compatible" as const,
    name: "My Provider",
    options: { baseURL: "https://example.com/v1" },
    models: {
      "model-1": {
        name: "Model One",
        reasoning: true as const,
        variants: {
          max: { reasoningEffort: "max" as const },
          low: { reasoningEffort: "low" as const },
        },
      },
    },
  }

  it("clears an existing variant map when the saved order changes", () => {
    const existing = {
      models: {
        "model-1": {
          variants: {
            low: { reasoningEffort: "low" },
            max: { reasoningEffort: "max" },
          },
        },
      },
    }

    expect(providerReset(existing, next)).toEqual({
      models: {
        "model-1": {
          variants: {
            low: null,
            max: null,
          },
        },
      },
    })
  })

  it("does not clear variants when the order is unchanged", () => {
    const existing = {
      models: {
        "model-1": {
          variants: {
            max: { reasoningEffort: "max" },
            low: { reasoningEffort: "low" },
          },
        },
      },
    }

    expect(providerReset(existing, next)).toBeUndefined()
  })

  it("resets parent cost and limit fields when child keys are removed", () => {
    const existing = {
      models: {
        "model-1": {
          limit: { context: 128000, input: 128000, output: 8192 },
          cost: { input: 3, output: 15, cache_read: 0.3 },
        },
      },
    }
    const updated = {
      ...next,
      models: {
        "model-1": {
          name: "Model One",
          limit: { context: 128000, output: 8192 },
          cost: { input: 3, output: 15 },
        },
      },
    }

    expect(providerReset(existing, updated)).toEqual({
      models: {
        "model-1": {
          limit: null,
          cost: null,
        },
      },
    })
  })
})

describe("withCustomProviderDeletions", () => {
  const baseNext = {
    npm: "@ai-sdk/openai-compatible" as const,
    name: "My Provider",
    options: { baseURL: "https://example.com/v1" },
    models: { keep: { name: "Keep" } },
  }

  it("passes through unchanged when there is no prior config", () => {
    expect(withCustomProviderDeletions(undefined, baseNext)).toEqual(baseNext)
    expect(withCustomProviderDeletions({}, baseNext)).toEqual(baseNext)
  })

  it("emits null for models present in existing but absent in next", () => {
    const existing = { models: { keep: { name: "Keep" }, gone: { name: "Gone" } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    const models = result.models as Record<string, unknown>
    expect(models.keep).toEqual({ name: "Keep" })
    expect(models.gone).toBeNull()
  })

  it("emits null for reasoning and variants removed from a surviving model", () => {
    const existing = {
      models: {
        keep: {
          name: "Keep",
          reasoning: true,
          variants: { high: { reasoningEffort: "high" }, low: { reasoningEffort: "low" } },
        },
      },
    }
    const next = {
      ...baseNext,
      models: {
        keep: { name: "Keep", variants: { high: { reasoningEffort: "high" } } },
      },
    } as typeof baseNext
    const result = withCustomProviderDeletions(existing, next)
    const model = (result.models as Record<string, { reasoning?: boolean | null; variants?: Record<string, unknown> }>)
      .keep
    expect(model.reasoning).toBeNull()
    expect(model.variants?.high).toEqual({ reasoningEffort: "high" })
    expect(model.variants?.low).toBeNull()
  })

  it("emits null when reasoning is disabled on a surviving model", () => {
    const existing = { models: { keep: { name: "Keep", reasoning: true } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    expect(result.models.keep).toEqual({ name: "Keep", reasoning: null })
  })

  it("emits null for options removed from a surviving variant", () => {
    const existing = {
      models: {
        keep: {
          name: "Keep",
          variants: {
            thinking: { thinking: { type: "adaptive" }, reasoning_split: true, reasoningEffort: "high" },
          },
        },
      },
    }
    const next = {
      ...baseNext,
      models: {
        keep: { name: "Keep", variants: { thinking: { reasoningEffort: "high" } } },
      },
    } as typeof baseNext
    const result = withCustomProviderDeletions(existing, next)
    const model = (result.models as Record<string, { variants: Record<string, unknown> }>).keep
    expect(model.variants.thinking).toEqual({ reasoningEffort: "high", thinking: null, reasoning_split: null })
  })

  it("does not touch variants on a model that is being deleted", () => {
    const existing = { models: { gone: { name: "Gone", variants: { a: {} } } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    const models = result.models as Record<string, unknown>
    expect(models.gone).toBeNull()
  })

  it("emits the replacement limit after providerReset clears removed child fields", () => {
    const existing = { models: { keep: { name: "Keep", limit: { context: 128000, input: 128000, output: 8192 } } } }
    const next = {
      ...baseNext,
      models: {
        keep: { name: "Keep", limit: { context: 128000, output: 8192 } },
      },
    }
    const result = withCustomProviderDeletions(existing, next)
    expect(result.models.keep).toEqual({ name: "Keep", limit: { context: 128000, output: 8192 } })
  })

  it("emits the replacement cost after providerReset clears removed child fields", () => {
    const existing = { models: { keep: { name: "Keep", cost: { input: 3, output: 15, cache_read: 0.3 } } } }
    const next = {
      ...baseNext,
      models: {
        keep: { name: "Keep", cost: { input: 3, output: 15 } },
      },
    }
    const result = withCustomProviderDeletions(existing, next)
    expect(result.models.keep).toEqual({ name: "Keep", cost: { input: 3, output: 15 } })
  })

  it("emits null when modalities are removed from a surviving model", () => {
    const existing = { models: { keep: { name: "Keep", modalities: { input: ["text", "image"], output: ["text"] } } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    expect(result.models.keep).toEqual({ name: "Keep", modalities: null })
  })

  it("emits null for provider env removed from the next config", () => {
    const existing = { env: ["OLD_API_KEY"], models: { keep: { name: "Keep" } } }
    const result = withCustomProviderDeletions(existing, baseNext)
    expect(result.env).toBeNull()
  })

  it("emits null for provider headers removed from the next config", () => {
    const existing = {
      options: { baseURL: "https://example.com/v1", headers: { Authorization: "Bearer old" } },
      models: { keep: { name: "Keep" } },
    }
    const result = withCustomProviderDeletions(existing, baseNext)
    expect(result.options).toEqual({ baseURL: "https://example.com/v1", headers: null })
  })

  it("emits null when WebSocket is disabled", () => {
    const existing = {
      options: { baseURL: "https://example.com/v1", websocket: true },
      models: { keep: { name: "Keep" } },
    }
    const result = withCustomProviderDeletions(existing, baseNext)
    expect(result.options).toEqual({ baseURL: "https://example.com/v1", websocket: null })
  })

  it("emits null for individual provider headers removed from the next config", () => {
    const existing = {
      options: {
        baseURL: "https://example.com/v1",
        headers: { Authorization: "Bearer old", "X-Keep": "yes" },
      },
      models: { keep: { name: "Keep" } },
    }
    const next = {
      ...baseNext,
      options: { baseURL: "https://example.com/v1", headers: { "X-Keep": "yes" } },
    }

    const result = withCustomProviderDeletions(existing, next)
    expect(result.options).toEqual({
      baseURL: "https://example.com/v1",
      headers: { "X-Keep": "yes", Authorization: null },
    })
  })
})

describe("customProviderConfigPatches", () => {
  const baseNext = {
    npm: "@ai-sdk/openai-compatible" as const,
    name: "My Provider",
    options: { baseURL: "https://example.com/v1" },
    models: { keep: { name: "Keep" } },
  }

  it("returns both the reset and the main patch when child fields are removed", () => {
    // 旧 limit 有 input,新 limit 没有:必须先应用 reset(limit 整体置 null)再应用 patch,
    // 否则深合并后 limit.input 会残留在磁盘配置中。
    const existing = { models: { keep: { name: "Keep", limit: { context: 128000, input: 128000, output: 8192 } } } }
    const next = {
      ...baseNext,
      models: { keep: { name: "Keep", limit: { context: 128000, output: 8192 } } },
    }

    const { reset, patch } = customProviderConfigPatches(existing, next)
    // 两个补丁必须与旧的成对入口输出完全一致,保证既有调用方迁移后行为不变。
    expect(reset).toEqual(providerReset(existing, next))
    expect(reset).toEqual({ models: { keep: { limit: null } } })
    expect(patch).toEqual(withCustomProviderDeletions(existing, next))
    expect(patch.models.keep).toEqual({ name: "Keep", limit: { context: 128000, output: 8192 } })
  })

  it("omits the reset key when no reset is needed", () => {
    const result = customProviderConfigPatches(undefined, baseNext)
    expect("reset" in result).toBe(false)
    expect(result.patch).toEqual(baseNext)
  })

  it("returns a reset when a cost child field is removed", () => {
    const existing = { models: { keep: { name: "Keep", cost: { input: 3, output: 15, cache_read: 0.3 } } } }
    const next = {
      ...baseNext,
      models: { keep: { name: "Keep", cost: { input: 3, output: 15 } } },
    }

    const { reset, patch } = customProviderConfigPatches(existing, next)
    expect(reset).toEqual({ models: { keep: { cost: null } } })
    expect(patch.models.keep).toEqual({ name: "Keep", cost: { input: 3, output: 15 } })
  })
})
