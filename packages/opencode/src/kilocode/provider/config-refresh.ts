import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import {
  compileConfigModels,
  compileProviderInfo,
  finalizeProviderModels,
  resolveEnvApiKey,
} from "@/kilocode/provider/compile"
import type { Info } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { Effect } from "effect"
import { isDeepEqual } from "remeda"

type Entry = ConfigProviderV1.Info | null | undefined

export type BuildInput = {
  id: ProviderV2.ID
  config: Entry
  base?: Info
  key?: string
  experimental: boolean
}

type Runtime<Model, SDK, Loader, Vars> = {
  config: Config.Info
  models: Map<string, Model>
  providers: Record<ProviderV2.ID, Info>
  catalog: Record<ProviderV2.ID, Info>
  sdk: Map<string, SDK>
  /**
   * resolveSDK 的 single-flight 在飞加载表（F68）。只需要遍历与删除能力，
   * 用最小结构类型以兼容 provider.ts 侧 Map<string, Promise<SDK>> 的实际形状。
   */
  sdkLoads: { keys(): IterableIterator<string>; delete(key: string): boolean }
  websockets: Map<string, { close(): void }>
  modelLoaders: Record<string, Loader>
  varsLoaders: Record<string, Vars>
  version: Map<ProviderV2.ID, number>
}

export type RefreshInput<Model, SDK, Loader, Vars> = {
  config: Config.Info
  state: Runtime<Model, SDK, Loader, Vars>
  auth: (id: ProviderV2.ID) => Effect.Effect<Auth.Info | undefined>
  env: Effect.Effect<Record<string, string | undefined>>
  experimental: boolean
  /**
   * 存在 plugin auth loader 的 Provider ID 集合。这些 Provider 的运行时
   * options 可能由插件注入（provider.ts 的 plugin auth loader 分支），
   * 增量重建无法复现注入结果，必须回退完整重建。不传时视为无插件注入。
   */
  pluginAuthProviders?: ReadonlySet<string>
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
    .map((id) => ProviderV2.ID.make(id))
}

/**
 * 从最终合并后的配置编译一个 Provider。配置不再包含模型时返回 undefined，
 * 由调用方从运行时注册表删除该 Provider。
 *
 * 编译逻辑与 provider.ts 全量构建路径共享同一实现（见 compile.ts），
 * 保证增量刷新产物与重启后的全量重建产物逐字段一致。
 */
export function build(input: BuildInput): Info | undefined {
  const config = input.config
  if (!config) return

  const provider = compileProviderInfo({ id: input.id, config, base: input.base })
  if (input.key !== undefined) provider.key = input.key

  compileConfigModels({
    providerID: input.id,
    config,
    models: provider.models,
  })
  finalizeProviderModels({
    provider,
    configProvider: config,
    experimental: input.experimental,
  })

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
    // 启停名单判定（审核条目 F05）：命中 disabled_providers 或不在
    // enabled_providers 中的 Provider 在全量构建时会被整体删除，增量路径
    // 若继续编译会把已禁用的 Provider 写回运行时注册表（"复活"），与重启
    // 后行为不一致。diff() 已保证两份配置除 provider 段外完全一致，因此
    // 启停名单直接读取新配置即可。语义与 provider.ts 的 isProviderAllowed
    // 保持一致。
    const disabled = new Set(input.config.disabled_providers ?? [])
    const enabled = input.config.enabled_providers ? new Set(input.config.enabled_providers) : null
    const allowed = (id: ProviderV2.ID) => {
      if (enabled && !enabled.has(id)) return false
      if (disabled.has(id)) return false
      return true
    }
    const incremental =
      changed !== undefined &&
      changed.every(
        (id) =>
          !input.state.catalog[id] &&
          (!input.state.providers[id] || input.state.providers[id].source === "config") &&
          allowed(id) &&
          // 插件注入判定（审核条目 F40）：存在 plugin auth loader 的
          // Provider 走完整重建，避免丢失插件注入的 options。其余插件注入
          // 途径无需额外检测：plugin provider.models hook 只作用于 models.dev
          // 目录内的 Provider（已被上面的 `!catalog[id]` 守卫排除）；plugin
          // config() hook 的产物已合并进 config.get() 返回的配置快照，diff()
          // 对比的就是合并后的结果。
          !input.pluginAuthProviders?.has(id),
      )
    if (!incremental) return false

    const env = yield* input.env
    const next = yield* Effect.forEach(changed, (id) =>
      Effect.gen(function* () {
        const auth = yield* input.auth(id)
        if (auth && auth.type !== "api") return { id, oauth: true as const }
        const entry = input.config.provider?.[id]
        // key 注入语义与全量构建对齐（审核条目 F37）：优先使用已保存的
        // API auth key；否则按 resolveEnvApiKey 的全量语义解析 env var
        // （仅声明恰好一个 env var 时才注入值，多个时交由 SDK 自行读取）。
        const key = auth?.key ?? resolveEnvApiKey(entry?.env, env).key
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
        // 同步清除 in-flight 的 single-flight 条目（F68）：热更新只改 models 不改
        // options 时 SDK key 不变，若不清除，刷新后的新调用会命中旧 in-flight——
        // 旧加载完成时因 version 失配不入缓存、close transport，却把该 SDK 返回给
        // 新调用者（WebSocket Provider 场景下本次请求会经已 close 的连接池发出）。
        // 删除条目后新调用发起全新加载；旧加载完成时照常被 version 检查拦截。
        for (const key of input.state.sdkLoads.keys()) {
          if (key.startsWith(prefix)) input.state.sdkLoads.delete(key)
        }
        for (const [key, transport] of input.state.websockets) {
          if (!key.startsWith(prefix)) continue
          transport.close()
          input.state.websockets.delete(key)
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
