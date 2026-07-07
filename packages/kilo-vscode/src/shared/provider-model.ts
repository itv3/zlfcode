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
  "@ai-sdk/google": { protocol: "gemini", catalog: "google", suffix: "/v1beta", suffixPattern: /\/v1(?:beta)?$/i },
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
