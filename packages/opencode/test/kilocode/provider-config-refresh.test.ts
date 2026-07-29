import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Effect, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import * as ConfigRefresh from "../../src/kilocode/provider/config-refresh"
import type { Info } from "../../src/provider/provider"
import * as ProviderReady from "../../src/kilocode/provider/ready"
import { disposeAllInstances, provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const root = Global.Path.config
const auth = process.env.KILO_AUTH_CONTENT
const id = ProviderV2.ID.make("13")
const other = ProviderV2.ID.make("14")

const deps = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  FSUtil.defaultLayer,
  Env.defaultLayer,
  Config.defaultLayer,
  Auth.defaultLayer,
  Plugin.defaultLayer,
  ModelsDev.defaultLayer,
  RuntimeFlags.defaultLayer,
  testInstanceStoreLayer,
)
const it = testEffect(Provider.layer.pipe(Layer.provideMerge(deps)))

function config(input: {
  name?: string
  baseURL?: string
  models: Record<string, { name: string } | null>
}): Config.Info {
  return {
    provider: {
      "13": {
        name: input.name ?? "Custom Provider",
        npm: "@ai-sdk/openai-compatible",
        models: input.models,
        options: {
          apiKey: "config-key",
          baseURL: input.baseURL ?? "https://old.example.test/v1",
        },
      },
    },
  }
}

const patch = (value: Config.Info) => Config.Service.use((service) => service.updateGlobal(value)).pipe(Effect.asVoid)

const project = (dir: string, value: Config.Info) =>
  Config.Service.use((service) => service.update(value)).pipe(provideInstanceEffect(dir))

const model = (dir: string, value: string) =>
  Provider.Service.use((provider) => provider.getModel(id, ModelV2.ID.make(value))).pipe(provideInstanceEffect(dir))

const provider = (dir: string) =>
  Provider.Service.use((service) => service.getProvider(id)).pipe(provideInstanceEffect(dir))

const providers = (dir: string) =>
  Provider.Service.use((service) => service.list()).pipe(provideInstanceEffect(dir))

const language = (dir: string, providerID: ProviderV2.ID, modelID: string) =>
  Provider.Service.use((service) =>
    service.getModel(providerID, ModelV2.ID.make(modelID)).pipe(Effect.flatMap(service.getLanguage)),
  ).pipe(provideInstanceEffect(dir))

const ready = (dir: string, models: string[]) =>
  ProviderReady.check({ providerID: id, modelIDs: models.map((model) => ModelV2.ID.make(model)) }).pipe(
    provideInstanceEffect(dir),
  )

afterEach(async () => {
  ;(Global.Path as { config: string }).config = root
  if (auth === undefined) delete process.env.KILO_AUTH_CONTENT
  else process.env.KILO_AUTH_CONTENT = auth
  await disposeAllInstances()
})

describe("自定义 Provider 配置热更新", () => {
  it.live("运行期间新增、删除和修改模型配置并保留其他状态", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      process.env.KILO_AUTH_CONTENT = JSON.stringify({ "13": { type: "api", key: "auth-key" } })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify({
            ...config({ models: { "gpt-5.5": { name: "GPT 5.5" } } }),
            model: "13/gpt-5.5",
            username: "alice",
          }),
        ),
      )

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")
      const pending = yield* ready(workspace, ["gpt-5.6-sol"])
      expect({
        ready: pending.ready,
        missing: pending.missing.map(String),
        unexpected: pending.unexpected.map(String),
      }).toEqual({
        ready: false,
        missing: ["gpt-5.6-sol"],
        unexpected: ["gpt-5.5"],
      })

      yield* patch(
        config({
          name: "Updated Provider",
          baseURL: "https://new.example.test/v1",
          models: {
            "gpt-5.5": { name: "GPT 5.5" },
            "gpt-5.6-sol": { name: "GPT 5.6 Sol" },
          },
        }),
      )

      expect(yield* ready(workspace, ["gpt-5.5", "gpt-5.6-sol"])).toEqual({
        ready: true,
        missing: [],
        unexpected: [],
      })
      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
      expect((yield* provider(workspace)).name).toBe("Updated Provider")
      expect((yield* provider(workspace)).options.baseURL).toBe("https://new.example.test/v1")

      yield* patch(config({ models: { "gpt-5.5": null, "gpt-5.6-sol": { name: "GPT 5.6 Sol" } } }))

      const removed = yield* model(workspace, "gpt-5.5").pipe(Effect.exit)
      expect(removed._tag).toBe("Failure")
      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
      expect(yield* ready(workspace, ["gpt-5.6-sol"])).toEqual({ ready: true, missing: [], unexpected: [] })

      const loaded = yield* Effect.all({
        auth: Auth.Service.use((service) => service.get("13")),
        config: Config.Service.use((service) => service.get()).pipe(provideInstanceEffect(workspace)),
      })
      expect(loaded.auth).toMatchObject({ type: "api", key: "auth-key" })
      expect(loaded.config.model).toBe("13/gpt-5.5")
      expect(loaded.config.username).toBe("alice")
    }),
  )

  it.live("一次全局保存刷新多个已活动实例", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const one = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      const two = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })),
        ),
      )

      expect((yield* model(one, "gpt-5.5")).name).toBe("GPT 5.5")
      expect((yield* model(two, "gpt-5.5")).name).toBe("GPT 5.5")

      yield* patch(
        config({
          models: {
            "gpt-5.5": { name: "GPT 5.5" },
            "gpt-5.6-sol": { name: "GPT 5.6 Sol" },
          },
        }),
      )

      expect((yield* model(one, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
      expect((yield* model(two, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
      expect((yield* ready(one, ["gpt-5.5", "gpt-5.6-sol"])).ready).toBe(true)
      expect((yield* ready(two, ["gpt-5.5", "gpt-5.6-sol"])).ready).toBe(true)
    }),
  )

  it.live("直接编辑全局配置并读取配置后仍会刷新 Provider", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      const file = path.join(global, "kilo.jsonc")
      yield* Effect.promise(() =>
        Bun.write(file, JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } }))),
      )

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")

      yield* Effect.promise(() =>
        Bun.write(
          file,
          JSON.stringify(
            config({
              models: {
                "gpt-5.5": { name: "GPT 5.5" },
                "gpt-5.6-sol": { name: "GPT 5.6 Sol" },
              },
            }),
          ),
        ),
      )
      yield* Config.Service.use((service) => service.getGlobal())

      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
    }),
  )

  it.live("首次全局配置解析失败后修复文件无需重启即可恢复 Provider", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      const file = path.join(global, "kilo.jsonc")
      yield* Effect.promise(() => Bun.write(file, "{ invalid"))

      expect((yield* providers(workspace))[id]).toBeUndefined()

      yield* Effect.promise(() =>
        Bun.write(file, JSON.stringify(config({ models: { "gpt-5.6-sol": { name: "GPT 5.6 Sol" } } }))),
      )

      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
    }),
  )

  it.live("项目配置更新后刷新当前工作区 Provider", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global

      yield* project(workspace, config({ models: { "gpt-5.5": { name: "GPT 5.5" } } }))
      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")

      yield* project(
        workspace,
        config({
          models: {
            "gpt-5.5": { name: "GPT 5.5" },
            "gpt-5.6-sol": { name: "GPT 5.6 Sol" },
          },
        }),
      )

      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
    }),
  )

  it.live("连续快速保存后使用最后一版模型集合", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })),
        ),
      )

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")

      yield* patch({ provider: { "13": { models: { "gpt-5.5": null } } } })
      yield* patch(config({ models: { "gpt-5.6-sol": { name: "GPT 5.6 Sol Final" } } }))

      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol Final")
      const removed = yield* model(workspace, "gpt-5.5").pipe(Effect.exit)
      expect(removed._tag).toBe("Failure")
    }),
  )

  it.live("删除最后一个模型后空模型集合立即就绪", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })),
        ),
      )

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")
      yield* patch(config({ models: { "gpt-5.5": null } }))

      expect(yield* ready(workspace, [])).toEqual({ ready: true, missing: [], unexpected: [] })
      expect((yield* providers(workspace))[id]).toBeUndefined()
      expect((yield* model(workspace, "gpt-5.5").pipe(Effect.exit))._tag).toBe("Failure")
    }),
  )

  it.live("删除整个 Provider 后运行时注册表立即移除", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })),
        ),
      )

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")
      yield* patch({ provider: { "13": null } })

      expect(yield* ready(workspace, [])).toEqual({ ready: true, missing: [], unexpected: [] })
      expect((yield* providers(workspace))[id]).toBeUndefined()
    }),
  )

  it.live("Provider 启停配置变化时保留完整重建语义", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })),
        ),
      )

      const before = yield* providers(workspace)
      expect(before[id]).toBeDefined()
      yield* patch({ disabled_providers: ["13"] })

      const after = yield* providers(workspace)
      expect(after[id]).toBeUndefined()
      expect(after).not.toBe(before)
    }),
  )

  it.live("精确更新目标 Provider 并保留其他 Provider 运行时状态", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      const initial = config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })
      initial.provider![other] = {
        name: "Other Provider",
        npm: "@ai-sdk/openai-compatible",
        models: { stable: { name: "Stable" } },
        options: { apiKey: "other-key", baseURL: "https://other.example.test/v1" },
      }
      yield* Effect.promise(() => Bun.write(path.join(global, "kilo.jsonc"), JSON.stringify(initial)))

      const before = yield* providers(workspace)
      const target = yield* language(workspace, id, "gpt-5.5")
      const stable = yield* language(workspace, other, "stable")

      yield* patch(
        config({
          name: "Updated Provider",
          baseURL: "https://new.example.test/v1",
          models: { "gpt-5.5": { name: "GPT 5.5 Updated" } },
        }),
      )

      const after = yield* providers(workspace)
      expect(after[other]).toBe(before[other])
      expect(yield* language(workspace, other, "stable")).toBe(stable)
      expect(yield* language(workspace, id, "gpt-5.5")).not.toBe(target)
      expect(after[id].options.baseURL).toBe("https://new.example.test/v1")
      expect(after[id].models["gpt-5.5"].name).toBe("GPT 5.5 Updated")
    }),
  )

  it.live("编辑已禁用的自定义 Provider 不会复活它", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify({
            ...config({ models: { "gpt-5.5": { name: "GPT 5.5" } } }),
            disabled_providers: ["13"],
          }),
        ),
      )

      // 初始全量构建会把被禁用的 Provider 从运行时注册表删除
      expect((yield* providers(workspace))[id]).toBeUndefined()

      // 编辑被禁用 Provider 的模型配置：diff() 只看到 provider 段变化，
      // 修复前增量路径会把 build() 产物写回注册表，"复活"被禁用的 Provider
      yield* patch(
        config({
          models: {
            "gpt-5.5": { name: "GPT 5.5" },
            "gpt-5.6-sol": { name: "GPT 5.6 Sol" },
          },
        }),
      )

      expect((yield* providers(workspace))[id]).toBeUndefined()
      expect((yield* model(workspace, "gpt-5.6-sol").pipe(Effect.exit))._tag).toBe("Failure")
    }),
  )

  it.live("编辑不在 enabled_providers 名单中的自定义 Provider 不会激活它", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify({
            ...config({ models: { "gpt-5.5": { name: "GPT 5.5" } } }),
            enabled_providers: ["kilo"],
          }),
        ),
      )

      expect((yield* providers(workspace))[id]).toBeUndefined()

      yield* patch(config({ models: { "gpt-5.5": { name: "GPT 5.5 Updated" } } }))

      expect((yield* providers(workspace))[id]).toBeUndefined()
    }),
  )

  it.live("增量刷新产物与重启后全量重建产物逐字段一致", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      // 声明两个 env var（触发 F37 的多 env var 语义），并让其中一个有值
      process.env.CUSTOM_PROVIDER_KEY_A = "value-a"
      yield* Effect.addFinalizer(() => Effect.sync(() => delete process.env.CUSTOM_PROVIDER_KEY_A))
      const initial: Config.Info = {
        provider: {
          "13": {
            name: "Custom Provider",
            npm: "@ai-sdk/openai-compatible",
            api: "https://old.example.test/v1",
            env: ["CUSTOM_PROVIDER_KEY_A", "CUSTOM_PROVIDER_KEY_B"],
            options: { baseURL: "https://old.example.test/v1" },
            models: {
              "gpt-5.5": { name: "GPT 5.5" },
              "stay-put": { name: "Stay Put" },
            },
          },
        },
      }
      yield* Effect.promise(() => Bun.write(path.join(global, "kilo.jsonc"), JSON.stringify(initial)))

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")

      // 尽量覆盖编译逻辑的各条分支：字段 fallback 链、id 映射、modalities、
      // cost/limit/headers/variants、删除哨兵、黑名单、deepseek interleaved 特判
      yield* patch({
        provider: {
          "13": {
            name: "Updated Provider",
            blacklist: ["blocked-model"],
            models: {
              "gpt-5.5": {
                name: "GPT 5.5 Updated",
                id: "gpt-5.5-actual",
                temperature: true,
                reasoning: true,
                attachment: true,
                tool_call: false,
                modalities: { input: ["text", "image"], output: ["text"] },
                cost: { input: 1.5, output: 6, cache_read: 0.5, cache_write: 2 },
                limit: { context: 200000, output: 64000 },
                headers: { "x-custom": "yes" },
                options: { reasoningEffort: "high" },
                family: "gpt",
                release_date: "2026-01-01",
                variants: { high: { reasoningEffort: "high" }, low: { reasoningEffort: "low" } },
              },
              "deepseek-alias": { id: "deepseek-chat", name: "DeepSeek Chat" },
              "stay-put": null,
              "blocked-model": { name: "Blocked" },
            },
          },
        },
      })

      const incremental = structuredClone((yield* providers(workspace))[id])
      expect(incremental).toBeDefined()
      // F37：声明多个 env var 时热更新不注入明文 key（与全量构建一致，交由 SDK 自行读取）
      expect(incremental.key).toBeUndefined()

      // 模拟重启：销毁全部实例后重新触发全量构建
      yield* Effect.promise(() => disposeAllInstances())
      const rebuilt = structuredClone((yield* providers(workspace))[id])

      // 核心断言：增量刷新产物与全量重建产物逐字段一致
      expect(incremental).toEqual(rebuilt)

      // 抽查关键字段，确保对拍不是在比较两个空产物
      expect(rebuilt.name).toBe("Updated Provider")
      expect(rebuilt.models["gpt-5.5"].api.id).toBe("gpt-5.5-actual")
      expect(rebuilt.models["gpt-5.5"].capabilities.input.image).toBe(true)
      expect(rebuilt.models["gpt-5.5"].cost.cache.write).toBe(2)
      expect(rebuilt.models["gpt-5.5"].headers).toMatchObject({ "x-custom": "yes" })
      expect(rebuilt.models["deepseek-alias"].capabilities.interleaved).toEqual({ field: "reasoning_content" })
      expect(rebuilt.models["stay-put"]).toBeUndefined()
      expect(rebuilt.models["blocked-model"]).toBeUndefined()
      expect(Object.keys(rebuilt.models["gpt-5.5"].variants ?? {}).slice(0, 2)).toEqual(["high", "low"])
    }),
  )

  it.live("单 env var 的 Provider 热更新后保留 env 注入的 key", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      process.env.CUSTOM_PROVIDER_KEY_A = "value-a"
      yield* Effect.addFinalizer(() => Effect.sync(() => delete process.env.CUSTOM_PROVIDER_KEY_A))
      const initial: Config.Info = {
        provider: {
          "13": {
            name: "Custom Provider",
            npm: "@ai-sdk/openai-compatible",
            api: "https://old.example.test/v1",
            env: ["CUSTOM_PROVIDER_KEY_A"],
            models: { "gpt-5.5": { name: "GPT 5.5" } },
          },
        },
      }
      yield* Effect.promise(() => Bun.write(path.join(global, "kilo.jsonc"), JSON.stringify(initial)))

      expect((yield* provider(workspace)).key).toBe("value-a")

      yield* patch({ provider: { "13": { models: { "gpt-5.5": { name: "GPT 5.5 Updated" } } } } })

      // 恰好声明一个 env var 时，增量刷新与全量构建一样注入该 env 值
      expect((yield* provider(workspace)).key).toBe("value-a")
      expect((yield* provider(workspace)).models["gpt-5.5"].name).toBe("GPT 5.5 Updated")
    }),
  )

  it.live("ready 检查失败只失效当前实例而不触发全局刷新", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })),
        ),
      )

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")
      const before = yield* providers(workspace)

      let notified = 0
      yield* ModelsRefresh.watch(() => Effect.sync(() => void (notified += 1)))

      const result = yield* ready(workspace, ["gpt-5.6-sol"])
      expect(result.ready).toBe(false)

      // 修复前失败路径调用全局 ModelsRefresh.notify()，会失效所有实例；
      // 修复后只失效当前实例，全局监听器不应被触发
      expect(notified).toBe(0)

      // 当前实例的 Provider 状态仍会被失效并重建
      const after = yield* providers(workspace)
      expect(after).not.toBe(before)
      expect(after[id].models["gpt-5.5"].name).toBe("GPT 5.5")
    }),
  )

  it.live("存在 plugin auth loader 的 Provider 变更回退完整重建", () =>
    Effect.gen(function* () {
      // 直接对 refresh() 做单元级验证：插件可能为目标 Provider 注入运行时
      // options（provider.ts 的 plugin auth loader 分支），增量重建无法复现
      // 注入结果，因此命中 pluginAuthProviders 的 id 必须回退完整重建
      const before = config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })
      const after = config({ models: { "gpt-5.5": { name: "GPT 5.5 Updated" } } })
      const make = (value: Config.Info) => ({
        config: value,
        models: new Map<string, unknown>(),
        providers: {} as Record<ProviderV2.ID, Info>,
        catalog: {} as Record<ProviderV2.ID, Info>,
        sdk: new Map<string, unknown>(),
        sdkLoads: new Map<string, unknown>(),
        websockets: new Map<string, { close(): void }>(),
        modelLoaders: {},
        varsLoaders: {},
        version: new Map<ProviderV2.ID, number>(),
      })
      const base = {
        auth: () => Effect.succeed(undefined),
        env: Effect.succeed({}),
        experimental: false,
      }

      // 无插件注入时正常走增量
      const refreshed = yield* ConfigRefresh.refresh({ ...base, config: after, state: make(before) })
      expect(refreshed).toBe(true)

      // 目标 Provider 存在 plugin auth loader 时回退完整重建
      const fallback = yield* ConfigRefresh.refresh({
        ...base,
        config: after,
        state: make(before),
        pluginAuthProviders: new Set(["13"]),
      })
      expect(fallback).toBe(false)
    }),
  )

  it.live("增量刷新清除目标 Provider 的 in-flight SDK 加载条目（F68）", () =>
    Effect.gen(function* () {
      // 热更新只改 models 不改 options 时 SDK key 不变：不清除 sdkLoads 会让
      // 刷新后的新调用命中旧 in-flight，拿到 version 失配、不入缓存且内嵌
      // 已 close transport 的 SDK。refresh 必须按 Provider 前缀清除 in-flight
      // 条目，且不误伤其他 Provider 的在飞加载。
      const before = config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })
      const after = config({ models: { "gpt-5.5": { name: "GPT 5.5 Updated" } } })
      const state = {
        config: before,
        models: new Map<string, unknown>(),
        providers: {} as Record<ProviderV2.ID, Info>,
        catalog: {} as Record<ProviderV2.ID, Info>,
        sdk: new Map<string, unknown>(),
        sdkLoads: new Map<string, unknown>([
          ["13/@ai-sdk/openai-compatible/{}", Promise.resolve("stale-load")],
          ["other/@ai-sdk/openai-compatible/{}", Promise.resolve("unrelated-load")],
        ]),
        websockets: new Map<string, { close(): void }>(),
        modelLoaders: {},
        varsLoaders: {},
        version: new Map<ProviderV2.ID, number>(),
      }

      const refreshed = yield* ConfigRefresh.refresh({
        auth: () => Effect.succeed(undefined),
        env: Effect.succeed({}),
        experimental: false,
        config: after,
        state,
      })

      expect(refreshed).toBe(true)
      // 目标 Provider（id "13"）的在飞条目被清除，其他 Provider 的保留。
      expect([...state.sdkLoads.keys()]).toEqual(["other/@ai-sdk/openai-compatible/{}"])
      // version 同步 bump，旧加载完成后会被防回写检查拦截。
      expect(state.version.get("13" as ProviderV2.ID)).toBe(1)
    }),
  )

  it.live("配置更新前启动的异步模型加载不会回写旧缓存", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      const module = path.join(global, "delayed-provider.mjs")
      yield* Effect.promise(() =>
        Bun.write(
          module,
          [
            "await new Promise((resolve) => setTimeout(resolve, 150))",
            "export function createDelayed(options) {",
            "  return { languageModel(id) { return { id, options } } }",
            "}",
          ].join("\n"),
        ),
      )
      const initial = config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })
      initial.provider![id]!.npm = pathToFileURL(module).href
      yield* Effect.promise(() => Bun.write(path.join(global, "kilo.jsonc"), JSON.stringify(initial)))

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")
      const fiber = yield* language(workspace, id, "gpt-5.5").pipe(Effect.forkChild)
      yield* Effect.sleep("30 millis")
      yield* patch(
        config({
          baseURL: "https://new.example.test/v1",
          models: { "gpt-5.5": { name: "GPT 5.5 Updated" } },
        }),
      )
      yield* providers(workspace)

      const stale = yield* Fiber.join(fiber)
      const fresh = yield* language(workspace, id, "gpt-5.5")
      expect(fresh).not.toBe(stale)
    }),
  )

  // 审核条目 F38：resolveSDK 对同 key 并发加载做 single-flight 去重。修复前两个
  // 并发 getLanguage 在 SDK 尚未入缓存时都会走完整加载流程（工厂被调用两次，
  // 后写覆盖先写；若 Provider 带 WebSocket transport，被覆盖一方创建的 transport
  // 永远不会被 close 而泄漏）。修复后同 key 并发共享同一个加载 Promise。
  it.live("并发 getLanguage 对同一 SDK 只执行一次加载（single-flight）", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      const module = path.join(global, "counted-provider.mjs")
      // 模块顶层延迟 100ms，制造两个并发调用都在 SDK 入缓存前进入 resolveSDK 的窗口；
      // 工厂调用计数记录在 globalThis，供测试断言加载只发生一次
      yield* Effect.promise(() =>
        Bun.write(
          module,
          [
            "await new Promise((resolve) => setTimeout(resolve, 100))",
            "export function createCounted(options) {",
            "  globalThis.__zlf_sdk_create_count = (globalThis.__zlf_sdk_create_count ?? 0) + 1",
            "  return { languageModel(id) { return { id, options } } }",
            "}",
          ].join("\n"),
        ),
      )
      const initial = config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })
      initial.provider![id]!.npm = pathToFileURL(module).href
      yield* Effect.promise(() => Bun.write(path.join(global, "kilo.jsonc"), JSON.stringify(initial)))

      expect((yield* model(workspace, "gpt-5.5")).name).toBe("GPT 5.5")
      ;(globalThis as Record<string, unknown>).__zlf_sdk_create_count = 0
      const left = yield* language(workspace, id, "gpt-5.5").pipe(Effect.forkChild)
      const right = yield* language(workspace, id, "gpt-5.5").pipe(Effect.forkChild)
      yield* Fiber.join(left)
      yield* Fiber.join(right)

      expect((globalThis as Record<string, unknown>).__zlf_sdk_create_count).toBe(1)
    }),
  )

  // 审核条目 F09：current() 的无锁快速路径——配置引用未变化时重复读取必须
  // 直接复用缓存状态（不重建、不刷新），同时配置变化后的热更新语义不受影响。
  it.live("配置未变化时重复读取复用缓存状态且热更新仍生效", () =>
    Effect.gen(function* () {
      const global = yield* tmpdirScoped()
      const workspace = yield* tmpdirScoped({ config: { formatter: false, lsp: false } })
      ;(Global.Path as { config: string }).config = global
      yield* Effect.promise(() =>
        Bun.write(
          path.join(global, "kilo.jsonc"),
          JSON.stringify(config({ models: { "gpt-5.5": { name: "GPT 5.5" } } })),
        ),
      )

      const first = yield* providers(workspace)
      const second = yield* providers(workspace)
      // 配置引用未变化：直接返回同一份缓存状态，不触发重建
      expect(second).toBe(first)

      yield* patch(config({ models: { "gpt-5.5": { name: "GPT 5.5" }, "gpt-5.6-sol": { name: "GPT 5.6 Sol" } } }))
      // 配置变化后新模型立即可用（热更新核心特性不受快速路径影响）
      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
    }),
  )
})
