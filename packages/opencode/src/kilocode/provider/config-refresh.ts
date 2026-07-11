import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import type { ConfigProvider } from "@/config/provider"
import { orderedVariants, patchConfigModel } from "@/kilocode/provider/provider"
import type { Info, Model } from "@/provider/provider"
import * as ProviderTransform from "@/provider/transform"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect } from "effect"
import { isDeepEqual, mapValues, mergeDeep } from "remeda"

type Entry = ConfigProvider.Info | null | undefined

export type BuildInput = {
  id: ProviderID
  config: Entry
  base?: Info
  key?: string
  experimental: boolean
}

type Runtime<Model, SDK, Loader, Vars> = {
  config: Config.Info
  models: Map<string, Model>
  providers: Record<ProviderID, Info>
  catalog: Record<ProviderID, Info>
  sdk: Map<string, SDK>
  modelLoaders: Record<string, Loader>
  varsLoaders: Record<string, Vars>
  version: Map<ProviderID, number>
}

export type RefreshInput<Model, SDK, Loader, Vars> = {
  config: Config.Info
  state: Runtime<Model, SDK, Loader, Vars>
  auth: (id: ProviderID) => Effect.Effect<Auth.Info | undefined>
  env: Effect.Effect<Record<string, string | undefined>>
  experimental: boolean
}

/**
 * 返回仅由 Provider 配置变化产生的 Provider ID 集合。
 * 返回 undefined 表示还存在其他配置变化，调用方必须采用完整重建语义。
 */
export function diff(before: Config.Info, after: Config.Info) {
  const previous = { ...before, provider: undefined }
  const current = { ...after, provider: undefined }
  if (!isDeepEqual(previous, current)) return

  const ids = new Set([...Object.keys(before.provider ?? {}), ...Object.keys(after.provider ?? {})])
  return [...ids]
    .filter((id) => !isDeepEqual(before.provider?.[id], after.provider?.[id]))
    .map((id) => ProviderID.make(id))
}

/**
 * 从最终合并后的配置编译一个 Provider。配置不再包含模型时返回 undefined，
 * 由调用方从运行时注册表删除该 Provider。
 */
export function build(input: BuildInput): Info | undefined {
  const config = input.config
  if (!config) return

  const models: Record<string, Model> = { ...(input.base?.models ?? {}) }
  const provider: Info = {
    id: input.id,
    name: config.name ?? input.base?.name ?? input.id,
    env: config.env ?? input.base?.env ?? [],
    options: mergeDeep(input.base?.options ?? {}, config.options ?? {}),
    source: "config",
    models,
  }
  if (input.key !== undefined) provider.key = input.key

  for (const [modelID, configModel] of Object.entries(config.models ?? {})) {
    if (!configModel) continue
    const existing = models[configModel.id ?? modelID]
    const apiID = configModel.id ?? existing?.api.id ?? modelID
    const apiNpm =
      configModel.provider?.npm ?? config.npm ?? existing?.api.npm ?? "@ai-sdk/openai-compatible"
    const name = (() => {
      if (configModel.name) return configModel.name
      if (configModel.id && configModel.id !== modelID) return modelID
      return existing?.name ?? modelID
    })()
    const model: Model = {
      id: ModelID.make(modelID),
      api: {
        id: apiID,
        npm: apiNpm,
        url: configModel.provider?.api ?? config.api ?? existing?.api.url ?? "",
      },
      status: configModel.status ?? existing?.status ?? "active",
      name,
      providerID: input.id,
      capabilities: {
        temperature: configModel.temperature ?? existing?.capabilities.temperature ?? false,
        reasoning: configModel.reasoning ?? existing?.capabilities.reasoning ?? false,
        attachment: configModel.attachment ?? existing?.capabilities.attachment ?? false,
        toolcall: configModel.tool_call ?? existing?.capabilities.toolcall ?? true,
        input: {
          text: configModel.modalities?.input?.includes("text") ?? existing?.capabilities.input.text ?? true,
          audio: configModel.modalities?.input?.includes("audio") ?? existing?.capabilities.input.audio ?? false,
          image: configModel.modalities?.input?.includes("image") ?? existing?.capabilities.input.image ?? false,
          video: configModel.modalities?.input?.includes("video") ?? existing?.capabilities.input.video ?? false,
          pdf: configModel.modalities?.input?.includes("pdf") ?? existing?.capabilities.input.pdf ?? false,
        },
        output: {
          text: configModel.modalities?.output?.includes("text") ?? existing?.capabilities.output.text ?? true,
          audio: configModel.modalities?.output?.includes("audio") ?? existing?.capabilities.output.audio ?? false,
          image: configModel.modalities?.output?.includes("image") ?? existing?.capabilities.output.image ?? false,
          video: configModel.modalities?.output?.includes("video") ?? existing?.capabilities.output.video ?? false,
          pdf: configModel.modalities?.output?.includes("pdf") ?? existing?.capabilities.output.pdf ?? false,
        },
        interleaved:
          configModel.interleaved ??
          existing?.capabilities.interleaved ??
          (!existing && apiNpm === "@ai-sdk/openai-compatible" && apiID.includes("deepseek")
            ? { field: "reasoning_content" }
            : false),
      },
      cost: {
        input: configModel.cost?.input ?? existing?.cost.input ?? 0,
        output: configModel.cost?.output ?? existing?.cost.output ?? 0,
        cache: {
          read: configModel.cost?.cache_read ?? existing?.cost.cache.read ?? 0,
          write: configModel.cost?.cache_write ?? existing?.cost.cache.write ?? 0,
        },
      },
      options: mergeDeep(existing?.options ?? {}, configModel.options ?? {}),
      limit: {
        context: configModel.limit?.context ?? existing?.limit.context ?? 0,
        input: configModel.limit?.input ?? existing?.limit.input,
        output: configModel.limit?.output ?? existing?.limit.output ?? 0,
      },
      headers: mergeDeep(existing?.headers ?? {}, configModel.headers ?? {}),
      family: configModel.family ?? existing?.family ?? "",
      release_date: configModel.release_date ?? existing?.release_date ?? "",
      ...patchConfigModel(configModel, existing),
    }
    model.variants = orderedVariants(ProviderTransform.variants(model), configModel.variants ?? {})
    models[modelID] = model
  }

  for (const [modelID, model] of Object.entries(provider.models)) {
    model.api.id = model.api.id ?? model.id ?? modelID
    if (model.status === "alpha" && !input.experimental) delete provider.models[modelID]
    if (model.status === "deprecated") delete provider.models[modelID]
    if (
      (config.blacklist && config.blacklist.includes(modelID)) ||
      (config.whitelist && !config.whitelist.includes(modelID))
    )
      delete provider.models[modelID]
    if (!model.variants || Object.keys(model.variants).length === 0) {
      model.variants = mapValues(ProviderTransform.variants(model), (variant) => variant)
    }
  }

  if (Object.keys(provider.models).length === 0) return
  return provider
}

/**
 * 在配置差异仅涉及非目录 Provider 时原子应用新快照。返回 false 表示该变化
 * 依赖目录、OAuth 或其他全局设置，调用方应保持原有完整重建语义。
 */
export function refresh<Model, SDK, Loader, Vars>(input: RefreshInput<Model, SDK, Loader, Vars>) {
  return Effect.gen(function* () {
    const changed = diff(input.state.config, input.config)
    const incremental =
      changed !== undefined &&
      changed.every(
        (id) =>
          !input.state.catalog[id] &&
          (!input.state.providers[id] || input.state.providers[id].source === "config"),
      )
    if (!incremental) return false

    const env = yield* input.env
    const next = yield* Effect.forEach(changed, (id) =>
      Effect.gen(function* () {
        const auth = yield* input.auth(id)
        if (auth && auth.type !== "api") return { id, oauth: true as const }
        const entry = input.config.provider?.[id]
        const key = auth?.key ?? entry?.env?.map((name) => env[name]).find(Boolean)
        const provider = build({
          id,
          config: entry,
          key,
          experimental: input.experimental,
        })
        return { id, oauth: false as const, provider }
      }),
    )
    if (next.some((item) => item.oauth)) return false

    yield* Effect.sync(() => {
      for (const item of next) {
        const prefix = `${item.id}/`
        for (const key of input.state.models.keys()) {
          if (key.startsWith(prefix)) input.state.models.delete(key)
        }
        for (const key of input.state.sdk.keys()) {
          if (key.startsWith(prefix)) input.state.sdk.delete(key)
        }
        delete input.state.modelLoaders[item.id]
        delete input.state.varsLoaders[item.id]
        if (item.provider) input.state.providers[item.id] = item.provider
        else delete input.state.providers[item.id]
        input.state.version.set(item.id, (input.state.version.get(item.id) ?? 0) + 1)
      }
      input.state.config = input.config
    })
    return true
  })
}
