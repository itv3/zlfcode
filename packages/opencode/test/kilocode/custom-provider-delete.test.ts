// https://github.com/Kilo-Org/kilocode/issues/9186 的回归测试。
//
// 用户删除自定义 provider 的模型、variant 或模型属性并保存后,被删除项
// 必须从磁盘配置中消失。保存路径依赖 `null` 哨兵,让 `mergeConfig`
// (merge + stripNulls) 可以干净地删除这些字段。

import { describe, expect, it } from "bun:test"
import * as Config from "../../src/config/config"
import { Schema } from "effect"
import { KilocodeConfig } from "../../src/kilocode/config/config"

describe("Config.Info — null sentinels for custom provider deletes", () => {
  it("accepts a null model value inside a provider", () => {
    const parsed = Schema.decodeUnknownResult(Config.Info)({
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-gone": null,
          },
        },
      },
    })
    expect(parsed._tag).toBe("Success")
  })

  it("accepts a null provider value", () => {
    const parsed = Schema.decodeUnknownResult(Config.Info)({
      provider: {
        myprovider: null,
      },
    })
    expect(parsed._tag).toBe("Success")
  })

  it("accepts a null variant value inside a model", () => {
    const parsed = Schema.decodeUnknownResult(Config.Info)({
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-1": {
              variants: {
                low: null,
              },
            },
          },
        },
      },
    })
    expect(parsed._tag).toBe("Success")
  })

  it("accepts null parent model property delete sentinels", () => {
    const parsed = Schema.decodeUnknownResult(Config.Info)({
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-1": {
              cost: null,
              limit: null,
              modalities: null,
            },
          },
        },
      },
    })
    expect(parsed._tag).toBe("Success")
  })
})

describe("KilocodeConfig.mergeConfig — custom provider model/variant deletion", () => {
  it("drops a model from an existing provider when the patch sets it to null", () => {
    const existing = {
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-keep": { name: "Keep" },
            "model-gone": { name: "Gone" },
          },
        },
      },
    } as unknown as Config.Info
    const patch = {
      provider: {
        myprovider: {
          models: {
            "model-keep": { name: "Keep" },
            "model-gone": null,
          },
        },
      },
    } as unknown as Config.Info

    const merged = KilocodeConfig.mergeConfig(existing, patch)
    const models = (merged.provider as Record<string, { models: Record<string, unknown> }>).myprovider.models
    expect(models["model-keep"]).toBeDefined()
    expect("model-gone" in models).toBe(false)
  })

  it("drops a provider when the patch sets it to null", () => {
    const existing = {
      provider: {
        myprovider: {
          name: "My Provider",
          models: { keep: { name: "Keep" } },
        },
        openai: {
          name: "OpenAI",
        },
      },
    } as unknown as Config.Info
    const patch = {
      provider: {
        myprovider: null,
      },
    } as unknown as Config.Info

    const merged = KilocodeConfig.mergeConfig(existing, patch)
    expect(merged.provider?.openai).toBeDefined()
    expect("myprovider" in (merged.provider ?? {})).toBe(false)
  })

  it("drops a variant from an existing model when the patch sets it to null", () => {
    const existing = {
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-1": {
              name: "Model One",
              variants: {
                high: { reasoningEffort: "high" },
                low: { reasoningEffort: "low" },
              },
            },
          },
        },
      },
    } as unknown as Config.Info
    const patch = {
      provider: {
        myprovider: {
          models: {
            "model-1": {
              variants: {
                high: { reasoningEffort: "high" },
                low: null,
              },
            },
          },
        },
      },
    } as unknown as Config.Info

    const merged = KilocodeConfig.mergeConfig(existing, patch)
    const variants = (
      merged.provider as Record<string, { models: Record<string, { variants: Record<string, unknown> }> }>
    ).myprovider.models["model-1"].variants
    expect(variants.high).toBeDefined()
    expect("low" in variants).toBe(false)
  })

  it("resets parent model properties before saving replacement values", () => {
    const existing = {
      provider: {
        myprovider: {
          name: "My Provider",
          models: {
            "model-1": {
              name: "Model One",
              cost: {
                input: 1,
                output: 2,
                cache_read: 0.1,
                cache_write: 0.2,
              },
              limit: {
                context: 1000,
                input: 900,
                output: 2000,
              },
              modalities: {
                input: ["text", "image"],
                output: ["text"],
              },
            },
          },
        },
      },
    } as unknown as Config.Info
    const reset = {
      provider: {
        myprovider: {
          models: {
            "model-1": {
              cost: null,
              limit: null,
              modalities: null,
            },
          },
        },
      },
    } as unknown as Config.Info
    const patch = {
      provider: {
        myprovider: {
          models: {
            "model-1": {
              cost: {
                input: 1,
                output: 2,
              },
              limit: {
                context: 1000,
                output: 2000,
              },
            },
          },
        },
      },
    } as unknown as Config.Info

    const merged = KilocodeConfig.mergeConfig(KilocodeConfig.mergeConfig(existing, reset), patch)
    const model = (
      merged.provider as Record<
        string,
        {
          models: Record<
            string,
            {
              cost?: Record<string, unknown>
              limit?: Record<string, unknown>
              modalities?: Record<string, unknown>
            }
          >
        }
      >
    ).myprovider.models["model-1"]
    expect(model.cost).toEqual({ input: 1, output: 2 })
    expect(model.limit).toEqual({ context: 1000, output: 2000 })
    expect("modalities" in model).toBe(false)
  })
})
