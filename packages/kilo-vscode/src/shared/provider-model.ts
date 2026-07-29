export const KILO_PROVIDER_ID = "kilo"
export const KILO_AUTO = { providerID: KILO_PROVIDER_ID, modelID: "kilo-auto/free" } as const
export const CUSTOM_PROVIDER_PACKAGES = [
  "@ai-sdk/openai-compatible",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/google",
] as const
export type CustomProviderPackage = (typeof CUSTOM_PROVIDER_PACKAGES)[number]
export const CUSTOM_PROVIDER_PACKAGE: CustomProviderPackage = "@ai-sdk/openai-compatible"
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/
export type CustomProviderProtocol = "openai" | "anthropic" | "gemini"
export type CustomProviderCatalog = "openai" | "anthropic" | "google"

const CUSTOM_PROVIDER_META: Record<
  CustomProviderPackage,
  { protocol: CustomProviderProtocol; catalog: CustomProviderCatalog; suffix?: string; suffixPattern?: RegExp }
> = {
  "@ai-sdk/openai-compatible": { protocol: "openai", catalog: "openai" },
  "@ai-sdk/openai": { protocol: "openai", catalog: "openai" },
  "@ai-sdk/anthropic": { protocol: "anthropic", catalog: "anthropic", suffix: "/v1", suffixPattern: /\/v1$/i },
  // Gemini 同时提供 v1 / v1beta / v1alpha 三个 API 版本(v1alpha 是实验特性入口),
  // 三者结尾的 baseURL 都视为已带版本段,不再追加默认的 /v1beta,
  // 避免把 .../v1alpha 误补成 .../v1alpha/v1beta 导致请求 404。
  "@ai-sdk/google": {
    protocol: "gemini",
    catalog: "google",
    suffix: "/v1beta",
    suffixPattern: /\/v1(?:beta|alpha)?$/i,
  },
}

// 协议到代表性包名的映射:同一协议的多个包共享同一套 baseURL 规范化规则,
// 供只知道协议(而非具体 npm 包名)的调用方(如模型发现)复用。
const PROTOCOL_PACKAGE: Record<CustomProviderProtocol, CustomProviderPackage> = {
  openai: "@ai-sdk/openai-compatible",
  anthropic: "@ai-sdk/anthropic",
  gemini: "@ai-sdk/google",
}

/**
 * Kilo 网关"auto small"特殊模型的 ID 集合（kilo-auto/small 与历史别名 auto-small）。
 * 该类模型默认不出现在模型选择器里，只有明确要求 includeSmall 的调用方才展示。
 * 定义放在共享层：extension host 与 webview（context 层、组件层）都可能需要
 * 这一判断，避免 context 层反向依赖组件层的工具模块。
 */
export const KILO_AUTO_SMALL_IDS = new Set(["kilo-auto/small", "auto-small"])

/** 判断模型是否属于 Kilo 网关的 auto-small 特殊模型。 */
export function isSmall(model: { providerID: string; id: string }): boolean {
  return model.providerID === KILO_PROVIDER_ID && KILO_AUTO_SMALL_IDS.has(model.id)
}

// Legacy/static fallback for provider objects created before backend metadata is available.
export const PROVIDER_PRIORITY = [
  KILO_PROVIDER_ID,
  "anthropic",
  "deepseek",
  "openai",
  "google",
  "openrouter",
  "vercel",
] as const

export function isCustomProviderPackage(value: unknown): value is CustomProviderPackage {
  return CUSTOM_PROVIDER_PACKAGES.includes(value as CustomProviderPackage)
}

export function customProviderProtocol(npm: CustomProviderPackage): CustomProviderProtocol {
  return CUSTOM_PROVIDER_META[npm].protocol
}

export function customProviderCatalog(npm: CustomProviderPackage): CustomProviderCatalog {
  return CUSTOM_PROVIDER_META[npm].catalog
}

export function normalizeCustomProviderBaseURL(npm: CustomProviderPackage, value: string) {
  const url = value.trim().replace(/\/+$/, "")
  const meta = CUSTOM_PROVIDER_META[npm]
  if (meta.suffix && meta.suffixPattern && !meta.suffixPattern.test(url)) return `${url}${meta.suffix}`
  return url
}

/**
 * 按协议规范化 baseURL:内部复用 normalizeCustomProviderBaseURL 的包名规则,
 * 保证扩展端与 webview 端对同一 baseURL 的处理结果一致。
 * 规范化是幂等的:已带版本段的 URL 原样返回,重复调用不会叠加后缀。
 */
export function normalizeProtocolBaseURL(protocol: CustomProviderProtocol, value: string) {
  return normalizeCustomProviderBaseURL(PROTOCOL_PACKAGE[protocol], value)
}

export function parseModelString(raw: string | undefined | null) {
  if (!raw) return null
  const slash = raw.indexOf("/")
  if (slash <= 0 || slash >= raw.length - 1) return null
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

export function providerOrderIndex(providerID: string, order = PROVIDER_PRIORITY) {
  const index = order.indexOf(providerID.toLowerCase() as (typeof PROVIDER_PRIORITY)[number])
  return index >= 0 ? index : order.length
}

export function createKiloFallbackProvider() {
  return {
    id: KILO_PROVIDER_ID,
    name: "Kilo Gateway",
    source: "custom" as const,
    env: ["KILO_API_KEY"],
    metadata: {
      noteKey: "settings.providers.note.kilo",
      icon: KILO_PROVIDER_ID,
      priority: 0,
    },
    models: {},
  }
}
