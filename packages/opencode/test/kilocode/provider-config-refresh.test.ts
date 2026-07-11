import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Env } from "../../src/env"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Plugin } from "../../src/plugin"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { disposeAllInstances, provideInstanceEffect, testInstanceStoreLayer, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const root = Global.Path.config
const auth = process.env.KILO_AUTH_CONTENT
const id = ProviderID.make("13")

const deps = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
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
}) {
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
  Provider.Service.use((provider) => provider.getModel(id, ModelID.make(value))).pipe(provideInstanceEffect(dir))

const provider = (dir: string) =>
  Provider.Service.use((service) => service.getProvider(id)).pipe(provideInstanceEffect(dir))

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

      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")
      expect((yield* provider(workspace)).name).toBe("Updated Provider")
      expect((yield* provider(workspace)).options.baseURL).toBe("https://new.example.test/v1")

      yield* patch(config({ models: { "gpt-5.5": null, "gpt-5.6-sol": { name: "GPT 5.6 Sol" } } }))

      const removed = yield* model(workspace, "gpt-5.5").pipe(Effect.exit)
      expect(removed._tag).toBe("Failure")
      expect((yield* model(workspace, "gpt-5.6-sol")).name).toBe("GPT 5.6 Sol")

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
})
