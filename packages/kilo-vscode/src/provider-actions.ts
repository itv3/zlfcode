/**
 * Provider action handlers extracted from KiloProvider to stay under max-lines.
 * These are pure async functions that operate on the SDK client — no vscode dependency.
 */
import type { Config, KiloClient } from "@kilocode/sdk/v2"
import { validateProviderID as validateProviderIDShared } from "./shared/custom-provider"
import {
  EnvSchema,
  providerReset,
  resolveCustomProviderAuth,
  sanitizeCustomProviderConfig,
  withCustomProviderDeletions,
} from "./shared/custom-provider"
import type { SanitizedProviderConfig } from "./shared/custom-provider"
import {
  customProviderProtocol,
  isCustomProviderPackage,
  KILO_AUTO,
  KILO_PROVIDER_ID,
  normalizeCustomProviderBaseURL,
  parseModelString,
} from "./shared/provider-model"
import type { CustomProviderPackage, CustomProviderProtocol } from "./shared/provider-model"
import { configFeatures } from "./features"

/**
 * Compute the default model selection from CLI config, VS Code settings, or hardcoded fallback.
 * Pure function — takes cachedConfig and vscode settings as parameters.
 */
type AuthState = "api" | "oauth" | "wellknown"
export type ProviderFetchMode = "connected" | "catalog"
export const DEFAULT_FAVORITES = [{ providerID: KILO_PROVIDER_ID, modelID: "stepfun/step-3.7-flash:free" }]
export const FAVORITES_SEEDED_KEY = "kilo.defaultFavoritesSeededV1"
const BUILTIN_CUSTOM_PROVIDER_IDS = new Set(["openai", "anthropic", "google", KILO_PROVIDER_ID])
const CATALOG_MODEL_PROVIDER_IDS = new Set([
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "opencode",
  "llmgateway",
  "zhipuai",
  "zai",
])

/** API key 只保留在扩展端,用于带认证的模型发现 (#10139)。 */
export interface StoredProviderKey {
  key?: string
  baseURL: string
  env?: string
  npm: CustomProviderPackage
}

type PublicProviderModel = {
  id: string
  name: string
  reasoning?: true
  capabilities?: {
    reasoning: boolean
    input?: { text: boolean; image: boolean; audio: boolean; video: boolean; pdf: boolean }
  }
  cost?: { input: number; output: number; cache?: { read: number; write: number } }
  limit?: { context: number; input?: number; output: number }
  variants?: Record<string, Record<string, unknown>>
}

type PublicProviderConfigModel = SanitizedProviderConfig["models"][string]

function disabledWithout(list: string[] | undefined, id: string) {
  return (list ?? []).filter((item) => item !== id)
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function customProviderPackage(config: unknown): CustomProviderPackage | undefined {
  if (!record(config)) return undefined
  if (isCustomProviderPackage(config.npm)) return config.npm
  const models = record(config.models) ? Object.values(config.models) : []
  for (const model of models) {
    if (!record(model)) continue
    const api = record(model.api) ? model.api : undefined
    if (isCustomProviderPackage(api?.npm)) return api.npm
  }
  return undefined
}

function customProvider(config: unknown) {
  return customProviderPackage(config) !== undefined
}

function publicInputCapabilities(model: PublicProviderConfigModel) {
  const input = model.modalities?.input
  return {
    text: input?.includes("text") ?? true,
    image: input?.includes("image") ?? false,
    audio: input?.includes("audio") ?? false,
    video: input?.includes("video") ?? false,
    pdf: input?.includes("pdf") ?? false,
  }
}

function publicCapabilities(model: PublicProviderConfigModel) {
  return {
    reasoning: model.reasoning === true,
    input: publicInputCapabilities(model),
  }
}

function publicCost(model: PublicProviderConfigModel) {
  if (!model.cost) return undefined
  return {
    input: model.cost.input,
    output: model.cost.output,
    cache: { read: model.cost.cache_read ?? 0, write: model.cost.cache_write ?? 0 },
  }
}

function publicCustomProviderModel(id: string, model: PublicProviderConfigModel): PublicProviderModel {
  const cost = publicCost(model)
  return {
    id,
    name: model.name,
    ...(model.reasoning ? { reasoning: true as const } : {}),
    capabilities: publicCapabilities(model),
    ...(cost ? { cost } : {}),
    ...(model.limit ? { limit: model.limit } : {}),
    ...(model.variants ? { variants: model.variants } : {}),
  }
}

function publicCustomProvider(id: string, config: SanitizedProviderConfig) {
  const models = Object.fromEntries(
    Object.entries(config.models).map(([modelID, model]) => [modelID, publicCustomProviderModel(modelID, model)]),
  )

  return {
    id,
    name: config.name,
    source: "config" as const,
    env: config.env ?? [],
    options: config.options,
    models,
  }
}

type ProviderChangeMessage =
  | {
      type: "providerConnected"
      requestId: string
      providerID: string
      provider?: ReturnType<typeof publicCustomProvider>
      authState?: AuthState
    }
  | {
      type: "providerDisconnected"
      requestId: string
      providerID: string
    }

function savedCustomProvider(
  config: unknown,
): config is Record<string, unknown> & { id: string } {
  if (!record(config)) return false
  if (!customProviderPackage(config)) return false
  if (typeof config.id !== "string") return false
  // 自定义 provider 保存 key 后会被后端 auth merge 成 source: "api",不能用 source 判断。
  return !BUILTIN_CUSTOM_PROVIDER_IDS.has(config.id.toLowerCase())
}

function envName(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const first = value.find((item) => typeof item === "string")
  const parsed = first === undefined ? undefined : EnvSchema.safeParse(first)
  return parsed?.success ? parsed.data : undefined
}

async function fetchProviderList(client: KiloClient, dir: string, mode: ProviderFetchMode) {
  if (mode === "catalog") {
    const { data } = await client.provider.list({ directory: dir }, { throwOnError: true })
    return data
  }

  const { data } = await client.config.providers({ directory: dir }, { throwOnError: true })
  const all = data.providers
  return {
    all,
    connected: all.map((item) => item.id),
    default: data.default,
    failed: [],
  }
}

function configuredCustomProviders(config: Config | undefined, connected: Set<string>) {
  const providers: Array<ReturnType<typeof publicCustomProvider>> = []
  const disabled = new Set(config?.disabled_providers ?? [])
  for (const [id, provider] of Object.entries(config?.provider ?? {})) {
    if (disabled.has(id) || !customProvider(provider)) continue
    const sanitized = sanitizeCustomProviderConfig(provider)
    if ("error" in sanitized) continue
    providers.push(publicCustomProvider(id, sanitized.value))
    connected.add(id)
  }
  return providers
}

function mergeConfiguredProviders<T extends { id: string }>(
  response: { all: T[]; connected: string[] },
  config: Config | undefined,
) {
  const connected = new Set(response.connected)
  const all = [...response.all]
  const seen = new Set(all.map((item) => item.id))
  for (const provider of configuredCustomProviders(config, connected)) {
    if (seen.has(provider.id)) continue
    all.push(provider as unknown as T)
    seen.add(provider.id)
  }
  return { all, connected: [...connected] }
}

function keepCatalogModels(id: string, connected: Set<string>, authStates: Record<string, AuthState>) {
  // 设置页只需要少量模型目录用于自定义 provider 默认值补全；
  // 其余 provider 保留基础信息即可，避免 Remote-SSH 下把超大 catalog
  // 整包塞进 webview 后把远端扩展宿主拖到无响应。
  return connected.has(id) || authStates[id] !== undefined || CATALOG_MODEL_PROVIDER_IDS.has(id)
}

function trimCatalogModels<T extends { id: string; models?: Record<string, unknown> }>(
  item: T,
  connected: Set<string>,
  authStates: Record<string, AuthState>,
): T {
  if (keepCatalogModels(item.id, connected, authStates)) return item
  if (!item.models || Object.keys(item.models).length === 0) return item
  return { ...item, models: {} } as T
}

/** 拉取 provider 可用性和认证状态,但不把已保存凭据暴露给 webview。 */
export async function fetchProviderData(client: KiloClient, dir: string, mode: ProviderFetchMode = "connected") {
  const configRequest =
    mode === "connected" && typeof client.config.get === "function"
      ? client.config
          .get({ directory: dir }, { throwOnError: true })
          .then((r) => r.data ?? undefined)
          .catch(() => undefined)
      : Promise.resolve(undefined)
  const authRequest =
    typeof client.provider.auth === "function"
      ? client.provider
          .auth({ directory: dir }, { throwOnError: true })
          .then((r) => r.data ?? {})
          .catch(() => ({}))
      : Promise.resolve({})
  const kiloRequest = client.kilo
    .authStatus({ directory: dir }, { throwOnError: true })
    .then((r) => (r.data?.authenticated ? (r.data.type ?? null) : null))
    .catch(() => null)

  const [raw, config, authMethods, kiloAuth] = await Promise.all([
    fetchProviderList(client, dir, mode),
    configRequest,
    authRequest,
    kiloRequest,
  ])
  const merged = mode === "connected" ? mergeConfiguredProviders(raw, config) : raw
  const response = { ...raw, all: merged.all, connected: merged.connected }
  const authStates: Record<string, AuthState> = {}
  const storedKeys: Record<string, StoredProviderKey> = {}
  const all = response.all.map((item) => {
    const raw = item as Record<string, unknown>
    if (typeof raw.id === "string" && typeof raw.key === "string" && raw.key) {
      authStates[raw.id] = "api"
    }
    const npm = customProviderPackage(raw)
    if (npm && savedCustomProvider(raw)) {
      // 扩展端保留 key,让已有自定义 provider 的模型发现可以认证,
      // 同时避免 secret 进入 webview (#10139)。这里只缓存带 baseURL
      // 的自定义 provider;fetch handler 还会校验 provider、URL 和协议。
      const options = record(raw.options) ? raw.options : undefined
      const baseURL = options && typeof options.baseURL === "string" ? options.baseURL : undefined
      const env = envName(raw.env)
      if (baseURL && (typeof raw.key === "string" || env)) {
        storedKeys[raw.id] = {
          ...(typeof raw.key === "string" && raw.key ? { key: raw.key } : {}),
          ...(env ? { env } : {}),
          baseURL,
          npm,
        }
      }
    }
    if (!("key" in raw)) return item
    const next = { ...raw }
    delete next.key
    return next as (typeof response.all)[number]
  })
  delete authStates[KILO_PROVIDER_ID]
  if (kiloAuth) authStates[KILO_PROVIDER_ID] = kiloAuth

  const connected = new Set(response.connected)
  const trimmed = mode === "catalog" ? all.map((item) => trimCatalogModels(item, connected, authStates)) : all
  return { response: { ...response, all: trimmed }, authMethods, authStates, storedKeys }
}

/**
 * 为已有 provider 的模型发现解析已保存 API key。
 * 只有请求 URL 匹配该 provider 的已配置 baseURL 时才会使用 key,
 * 避免用户编辑 URL 后把已保存 secret 转发到其他主机。
 */
export function resolveStoredKey(
  storedKeys: Record<string, StoredProviderKey>,
  providerID: unknown,
  url: string,
  protocol?: CustomProviderProtocol,
): string | undefined {
  if (typeof providerID !== "string" || !providerID) return undefined
  const stored = storedKeys[providerID]
  if (!stored) return undefined
  const normalize = (value: string) => value.trim().replace(/\/+$/, "")
  if (protocol && customProviderProtocol(stored.npm) !== protocol) return undefined
  const saved = normalizeCustomProviderBaseURL(stored.npm, stored.baseURL)
  if (normalize(saved) !== normalize(url)) return undefined
  if (stored.key) return stored.key
  return stored.env ? process.env[stored.env] : undefined
}

export function buildActionContext(
  client: KiloClient,
  post: (msg: unknown) => void,
  errFn: (err: unknown) => string,
  dir: string,
  refresh: () => Promise<void>,
  notify?: (message?: ProviderChangeMessage) => void,
): ActionContext {
  return {
    client,
    postMessage: post,
    getErrorMessage: errFn,
    workspaceDir: dir,
    disposeGlobal: async (reason: string) => {
      // Wait for the server to finish disposing before refreshing providers.
      // Shared State.dispose() now has a hard per-disposer timeout, so this
      // wait is bounded without needing a client-side timeout here.
      await client.global.dispose().catch((error: unknown) => {
        console.warn(`[Kilo New] KiloProvider: global.dispose() after ${reason} failed:`, error)
      })
    },
    fetchAndSendProviders: refresh,
    notifyProvidersChanged: notify,
  }
}

function isModelSelection(r: unknown): r is { providerID: string; modelID: string } {
  return (
    !!r &&
    typeof r === "object" &&
    typeof (r as Record<string, unknown>).providerID === "string" &&
    typeof (r as Record<string, unknown>).modelID === "string"
  )
}

/** Validate and sanitize recent model selections from untrusted sources. */
export function validateRecents(raw: unknown): Array<{ providerID: string; modelID: string }> {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isModelSelection)
    .slice(0, 5)
    .map((r) => ({ providerID: r.providerID, modelID: r.modelID }))
}

/** Validate and sanitize favorite model selections from untrusted sources. */
export function sanitizeFavorites(raw: unknown): Array<{ providerID: string; modelID: string }> {
  if (!Array.isArray(raw)) return []
  return raw.filter(isModelSelection).map((r) => ({ providerID: r.providerID, modelID: r.modelID }))
}

/** 兼容上游调用点;默认收藏初始化只放在 resolveFavorites。 */
export function validateFavorites(raw: unknown): Array<{ providerID: string; modelID: string }> {
  return sanitizeFavorites(raw)
}

export function resolveFavorites(raw: unknown, seeded: boolean): Array<{ providerID: string; modelID: string }> {
  const items = sanitizeFavorites(raw)
  if (seeded) return items
  if (Array.isArray(raw)) return items
  if (items.length > 0) return items
  return DEFAULT_FAVORITES.map((item) => ({ providerID: item.providerID, modelID: item.modelID }))
}

/** Validate and sanitize per-mode model selections from untrusted sources. */
export function validateModelSelections(raw: unknown): Record<string, { providerID: string; modelID: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const result: Record<string, { providerID: string; modelID: string }> = {}
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (isModelSelection(val)) {
      result[key] = { providerID: val.providerID, modelID: val.modelID }
    }
  }
  return result
}

export function computeDefaultSelection(
  cachedConfig: { config?: { model?: string } } | null,
  vscodePID: string,
  vscodeMID: string,
): { providerID: string; modelID: string } {
  const configured = parseModelString(cachedConfig?.config?.model)
  if (configured) return configured
  if (vscodePID && vscodeMID) return { providerID: vscodePID, modelID: vscodeMID }
  return { ...KILO_AUTO }
}

type PostMessage = (message: unknown) => void
type GetErrorMessage = (error: unknown) => string
type SetCachedConfig = (msg: unknown) => void
type AuthMetadata = Record<string, string>

interface ActionContext {
  client: KiloClient
  postMessage: PostMessage
  getErrorMessage: GetErrorMessage
  workspaceDir: string
  disposeGlobal: (reason: string) => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  notifyProvidersChanged?: (message?: ProviderChangeMessage) => void
}

function postError(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  action: "connect" | "disconnect" | "authorize",
  message: string,
) {
  ctx.postMessage({ type: "providerActionError", requestId, providerID, action, message })
}

function validateID(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  action: "connect" | "disconnect" | "authorize",
): string | null {
  const result = validateProviderIDShared(providerID)
  if ("value" in result) return result.value
  postError(ctx, requestId, providerID, action, result.error)
  return null
}

function cleanMetadata(input?: Record<string, unknown>): AuthMetadata | undefined {
  const entries = Object.entries(input ?? {})
    .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""] as const)
    .filter(([key, value]) => key !== "" && value !== "")
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

async function configs(ctx: ActionContext) {
  const [{ data: global }, { data: merged }] = await Promise.all([
    ctx.client.global.config.get({ throwOnError: true }),
    ctx.client.config.get({ directory: ctx.workspaceDir }, { throwOnError: true }),
  ])
  return { global: global ?? {}, merged: merged ?? {} }
}

async function refreshConfig(ctx: ActionContext, setCachedConfig: SetCachedConfig) {
  const [{ data: config }, { data: global }] = await Promise.all([
    ctx.client.config.get({ directory: ctx.workspaceDir }, { throwOnError: true }),
    ctx.client.global.config.get({ throwOnError: true }),
  ])
  if (!config) return
  const features = configFeatures(config)
  setCachedConfig({ type: "configLoaded", config, globalConfig: global, features })
  ctx.postMessage({ type: "configUpdated", config, globalConfig: global, features })
}

async function saveGlobal(ctx: ActionContext, config: Config) {
  await ctx.client.global.config.update({ config }, { throwOnError: true })
}

async function saveProject(ctx: ActionContext, config: Config) {
  await ctx.client.config.update({ config, directory: ctx.workspaceDir }, { throwOnError: true })
}

async function removeAuth(ctx: ActionContext, id: string, configured: boolean) {
  try {
    await ctx.client.auth.remove({ providerID: id }, { throwOnError: true })
  } catch (err) {
    if (!configured) throw err
    console.warn(`[Kilo New] auth.remove failed for configured provider ${id} (non-fatal):`, err)
  }
}

async function removeCustom(ctx: ActionContext, id: string, global: Config, merged: Config) {
  const cfg = global.provider?.[id]
  const effective = merged.provider?.[id]
  const tasks = []
  if (customProvider(cfg)) {
    tasks.push(
      saveGlobal(ctx, {
        provider: { [id]: null },
        disabled_providers: disabledWithout(global.disabled_providers, id),
      }),
    )
  }
  if (customProvider(effective)) {
    tasks.push(saveProject(ctx, { provider: { [id]: null } }))
  }
  await Promise.all(tasks)
}

async function disableConfigured(ctx: ActionContext, id: string, config: Config) {
  const disabled = config.disabled_providers ?? []
  if (disabled.includes(id)) return
  await saveGlobal(ctx, { disabled_providers: [...disabled, id] })
}

async function enableConfigured(ctx: ActionContext, id: string, config: Config) {
  const disabled = disabledWithout(config.disabled_providers, id)
  if (disabled.length === (config.disabled_providers ?? []).length) return
  await saveGlobal(ctx, { disabled_providers: disabled })
}

const PROVIDER_DISPOSE_TIMEOUT_MS = 7_000

async function disposeForRefresh(ctx: ActionContext, reason: string) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn(`[Kilo New] KiloProvider: provider dispose after ${reason} timed out`)
      resolve()
    }, PROVIDER_DISPOSE_TIMEOUT_MS)
    ctx.disposeGlobal(reason).then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function refreshProvidersNow(ctx: ActionContext, reason: string) {
  await disposeForRefresh(ctx, reason)
  await ctx.fetchAndSendProviders()
  ctx.notifyProvidersChanged?.()
}

async function refreshProvidersLightly(ctx: ActionContext, refresh?: () => Promise<void>) {
  await refresh?.()
  await ctx.fetchAndSendProviders()
  ctx.notifyProvidersChanged?.()
}

function refreshProvidersLater(ctx: ActionContext, reason: string, refresh?: () => Promise<void>) {
  void (async () => {
    await refresh?.()
    await refreshProvidersNow(ctx, reason)
  })().catch((error: unknown) => {
    console.warn(`[Kilo New] KiloProvider: provider refresh after ${reason} failed:`, error)
  })
}

function refreshProvidersLightlyLater(ctx: ActionContext, reason: string, refresh?: () => Promise<void>) {
  void refreshProvidersLightly(ctx, refresh).catch((error: unknown) => {
    console.warn(`[Kilo New] KiloProvider: provider refresh after ${reason} failed:`, error)
  })
}

export async function connectProvider(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  apiKey: string,
  metadata?: Record<string, unknown>,
) {
  const id = validateID(ctx, requestId, providerID, "connect")
  if (!id) return
  try {
    const meta = cleanMetadata(metadata)
    const auth = meta ? { type: "api" as const, key: apiKey, metadata: meta } : { type: "api" as const, key: apiKey }
    await ctx.client.auth.set({ providerID: id, auth }, { throwOnError: true })
    await ctx.disposeGlobal(`provider connect (${id})`)
    await ctx.fetchAndSendProviders()
    ctx.postMessage({ type: "providerConnected", requestId, providerID: id })
    ctx.notifyProvidersChanged?.()
  } catch (error) {
    postError(ctx, requestId, providerID, "connect", ctx.getErrorMessage(error) || "Failed to connect provider")
  }
}

export async function authorizeProviderOAuth(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  method: number,
) {
  const id = validateID(ctx, requestId, providerID, "authorize")
  if (!id) return
  try {
    const { data: authorization } = await ctx.client.provider.oauth.authorize(
      { providerID: id, method, directory: ctx.workspaceDir },
      { throwOnError: true },
    )
    if (!authorization) {
      postError(ctx, requestId, providerID, "authorize", "Failed to start provider authorization")
      return
    }
    ctx.postMessage({ type: "providerOAuthReady", requestId, providerID: id, authorization })
  } catch (error) {
    postError(
      ctx,
      requestId,
      providerID,
      "authorize",
      ctx.getErrorMessage(error) || "Failed to start provider authorization",
    )
  }
}

export async function completeProviderOAuth(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  method: number,
  code?: string,
) {
  const id = validateID(ctx, requestId, providerID, "connect")
  if (!id) return
  try {
    await ctx.client.provider.oauth.callback(
      { providerID: id, method, code, directory: ctx.workspaceDir },
      { throwOnError: true },
    )
    await ctx.disposeGlobal(`provider oauth (${id})`)
    await ctx.fetchAndSendProviders()
    ctx.postMessage({ type: "providerConnected", requestId, providerID: id })
    ctx.notifyProvidersChanged?.()
  } catch (error) {
    postError(
      ctx,
      requestId,
      providerID,
      "connect",
      ctx.getErrorMessage(error) || "Failed to complete provider authorization",
    )
  }
}

export async function disconnectProvider(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  cachedConfigMessage: unknown,
  setCachedConfig: SetCachedConfig,
) {
  const id = validateID(ctx, requestId, providerID, "disconnect")
  if (!id) return
  try {
    const config = await configs(ctx)
    const cfg = config.global.provider?.[id]
    const effective = config.merged.provider?.[id]
    const configured = !!cfg || !!effective
    const custom = customProvider(cfg) || customProvider(effective)
    const oauth = await (async () => {
      if (!configured || custom) return false
      const { response } = await fetchProviderData(ctx.client, ctx.workspaceDir)
      const active = response.all.find((item) => item.id === id)
      return active?.source === "custom"
    })()

    // Config-sourced providers may not have auth store entries because
    // credentials can come from config or env, so auth removal is non-fatal.
    await removeAuth(ctx, id, configured)

    if (id === "kilo") {
      ctx.postMessage({ type: "profileData", data: null })
    }

    if (custom) {
      await removeCustom(ctx, id, config.global, config.merged)
    }

    // Config-sourced built-in providers stay "connected" after auth.remove
    // because the server rebuilds state from config. Add to disabled_providers
    // so the server excludes them while preserving config for re-enable.
    if (configured && !oauth && !custom) {
      await disableConfigured(ctx, id, config.global)
    }

    if (oauth) {
      await enableConfigured(ctx, id, config.global)
    }

    const message = { type: "providerDisconnected" as const, requestId, providerID: id }
    ctx.postMessage(message)
    ctx.notifyProvidersChanged?.(message)
    const refresh = configured ? () => refreshConfig(ctx, setCachedConfig) : undefined
    if (custom) {
      refreshProvidersLightlyLater(ctx, `provider disconnect (${id})`, refresh)
      return
    }
    refreshProvidersLater(ctx, `provider disconnect (${id})`, refresh)
  } catch (error) {
    postError(ctx, requestId, providerID, "disconnect", ctx.getErrorMessage(error) || "Failed to disconnect provider")
  }
}

export async function saveCustomProvider(
  ctx: ActionContext,
  requestId: string,
  providerID: string,
  provider: Record<string, unknown>,
  apiKey: string | undefined,
  apiKeyChanged: boolean,
  cachedConfigMessage: unknown,
  setCachedConfig: (msg: unknown) => void,
) {
  const id = validateID(ctx, requestId, providerID, "connect")
  if (!id) return

  const sanitized = sanitizeCustomProviderConfig(provider)
  if ("error" in sanitized) {
    postError(ctx, requestId, providerID, "connect", sanitized.error)
    return
  }

  const refreshLater = () => {
    refreshProvidersLightlyLater(ctx, `custom provider save (${id})`)
  }
  const refreshConfigLater = () => {
    void refreshConfig(ctx, setCachedConfig).catch(() => undefined)
  }

  try {
    const globalConfig = (await ctx.client.global.config.get({ throwOnError: true })).data ?? {}
    const disabled = globalConfig.disabled_providers ?? []
    const nextDisabled = disabled.filter((item: string) => item !== id)
    const existing = globalConfig.provider?.[id]
    const reset = providerReset(existing, sanitized.value)
    if (reset) {
      await ctx.client.global.config.update(
        {
          config: {
            provider: { [id]: reset },
          },
        },
        { throwOnError: true },
      )
    }
    const patch = withCustomProviderDeletions(existing, sanitized.value)
    await (async () => {
      try {
        await ctx.client.global.config.update(
          {
            config: {
              provider: { [id]: patch },
              disabled_providers: nextDisabled,
            },
          },
          { throwOnError: true },
        )
      } catch (error) {
        if (reset && existing) {
          await ctx.client.global.config
            .update(
              {
                config: {
                  provider: { [id]: existing },
                },
              },
              { throwOnError: true },
            )
            .catch((err: unknown) => console.warn(`[Kilo New] failed to restore custom provider ${id}:`, err))
        }
        throw error
      }
    })()

    const auth = resolveCustomProviderAuth(apiKey, apiKeyChanged)

    try {
      if (auth.mode === "set") {
        await ctx.client.auth.set({ providerID: id, auth: { type: "api", key: auth.key } }, { throwOnError: true })
      }
      if (auth.mode === "clear") {
        await ctx.client.auth.remove({ providerID: id }, { throwOnError: true })
      }
    } catch (error) {
      refreshLater()
      refreshConfigLater()
      postError(ctx, requestId, providerID, "connect", ctx.getErrorMessage(error) || "Failed to save custom provider")
      return
    }

    refreshConfigLater()
    const message = {
      type: "providerConnected",
      requestId,
      providerID: id,
      provider: publicCustomProvider(id, sanitized.value),
      authState: auth.mode === "clear" ? undefined : "api",
    } as const
    ctx.postMessage(message)
    ctx.notifyProvidersChanged?.(message)
    refreshProvidersLightlyLater(ctx, `custom provider save (${id})`)
  } catch (error) {
    postError(ctx, requestId, providerID, "connect", ctx.getErrorMessage(error) || "Failed to save custom provider")
  }
}
