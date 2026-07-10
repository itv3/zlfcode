import { z } from "zod"
import { CUSTOM_PROVIDER_PACKAGE, CUSTOM_PROVIDER_PACKAGES, PROVIDER_ID_PATTERN } from "./provider-model"
import type { CustomProviderPackage } from "./provider-model"

const INVALID_PROVIDER_ID = "Invalid provider ID"
const INVALID_ENV = "Invalid environment variable name"
const INVALID_BASE_URL = "Base URL must start with http:// or https://"

export const ProviderIDSchema = z.string().trim().regex(PROVIDER_ID_PATTERN, INVALID_PROVIDER_ID)
export const EnvSchema = z
  .string()
  .trim()
  .regex(/^[A-Z_][A-Z0-9_]*$/, INVALID_ENV)

const VariantConfigSchema = z
  .object({
    enable_thinking: z.boolean().optional(),
    thinking: z
      .object({ type: z.enum(["enabled", "disabled", "adaptive"]) })
      .passthrough()
      .optional(),
    reasoning_split: z.boolean().optional(),
    reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    chat_template_args: z.object({ enable_thinking: z.boolean() }).passthrough().optional(),
  })
  .passthrough()

export type VariantConfig = z.infer<typeof VariantConfigSchema>

const ModalitySchema = z.enum(["text", "image", "audio", "video", "pdf"])

// 与 CLI provider schema 保持一致，保存表单时不能丢弃手写的 modality。
const ModelModalitiesSchema = z.object({
  input: z.array(ModalitySchema).optional(),
  output: z.array(ModalitySchema).optional(),
})

export type ModelModalities = z.infer<typeof ModelModalitiesSchema>

const ModelLimitSchema = z
  .object({
    context: z.number().int().positive(),
    input: z.number().int().positive().optional(),
    output: z.number().int().positive(),
  })
  .strict()
const ModelCostSchema = z
  .object({
    input: z.number().finite().nonnegative(),
    output: z.number().finite().nonnegative(),
    cache_read: z.number().finite().nonnegative().optional(),
    cache_write: z.number().finite().nonnegative().optional(),
  })
  .strict()

export const CustomProviderConfigSchema = z
  .object({
    npm: z.enum(CUSTOM_PROVIDER_PACKAGES).default(CUSTOM_PROVIDER_PACKAGE),
    name: z.string().trim().min(1).max(200),
    env: z.array(EnvSchema).max(1).optional(),
    options: z
      .object({
        baseURL: z
          .string()
          .trim()
          .url()
          .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
            message: INVALID_BASE_URL,
          }),
        headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
      })
      .strict(),
    models: z
      .record(
        z.string().trim().min(1),
        z
          .object({
            name: z.string().trim().min(1).max(200),
            reasoning: z.boolean().optional(),
            modalities: ModelModalitiesSchema.optional(),
            limit: ModelLimitSchema.optional(),
            cost: ModelCostSchema.optional(),
            variants: z.record(z.string().trim().min(1), VariantConfigSchema).optional(),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length > 0, "At least one model is required"),
  })
  .strict()

export type SanitizedProviderConfig = {
  npm: CustomProviderPackage
  name: string
  env?: string[]
  options: {
    baseURL: string
    headers?: Record<string, string>
  }
  models: Record<
    string,
    {
      name: string
      reasoning?: true
      modalities?: ModelModalities
      limit?: { context: number; input?: number; output: number }
      cost?: { input: number; output: number; cache_read?: number; cache_write?: number }
      variants?: Record<string, VariantConfig>
    }
  >
}

export type CustomProviderAuthChange = { mode: "preserve" } | { mode: "clear" } | { mode: "set"; key: string }

export const MASKED_CUSTOM_PROVIDER_KEY = "********"

type Issue = { error: string; issue?: z.ZodIssue }

function fail(error: string, issue?: z.ZodIssue): Issue {
  return issue ? { error, issue } : { error }
}

export function validateProviderID(providerID: string): { value: string } | Issue {
  const result = ProviderIDSchema.safeParse(providerID)
  if (result.success) return { value: result.data }
  const issue = result.error.issues[0]
  return fail(issue?.message ?? INVALID_PROVIDER_ID, issue)
}

export function parseCustomProviderSecret(raw: string): { value: { apiKey?: string; env?: string } } | Issue {
  const value = raw.trim()
  if (!value) return { value: {} }

  const match = value.match(/^\{env:([^}]+)\}$/)
  if (!match) return { value: { apiKey: value } }

  const env = match[1]?.trim() ?? ""
  const result = EnvSchema.safeParse(env)
  if (result.success) return { value: { env: result.data } }
  const issue = result.error.issues[0]
  return fail(issue?.message ?? INVALID_ENV, issue)
}

export function resolveCustomProviderAuth(apiKey: string | undefined, changed: boolean): CustomProviderAuthChange {
  const key = apiKey?.trim()
  if (!changed) return { mode: "preserve" }
  if (key) return { mode: "set", key }
  return { mode: "clear" }
}

export function resolveCustomProviderKey(auth: "api" | "oauth" | "wellknown" | undefined) {
  if (auth !== "api") return ""
  return MASKED_CUSTOM_PROVIDER_KEY
}

export function normalizeCustomProviderConfig(
  config: z.output<typeof CustomProviderConfigSchema>,
): SanitizedProviderConfig {
  const headers = config.options.headers
    ? Object.fromEntries(
        Object.entries(config.options.headers)
          .map(([key, value]) => [key.trim(), value.trim()] as const)
          .filter(([key, value]) => key.length > 0 && value.length > 0),
      )
    : undefined

  return {
    npm: config.npm,
    name: config.name.trim(),
    ...(config.env ? { env: config.env.map((item) => item.trim()) } : {}),
    options: {
      baseURL: config.options.baseURL.trim(),
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    },
    models: Object.fromEntries(
      Object.entries(config.models).map(([id, model]) => [
        id.trim(),
        {
          name: model.name.trim(),
          ...(model.reasoning ? { reasoning: true as const } : {}),
          ...(model.modalities ? { modalities: model.modalities } : {}),
          ...(model.limit ? { limit: model.limit } : {}),
          ...(model.cost ? { cost: model.cost } : {}),
          ...(model.variants && Object.keys(model.variants).length > 0 ? { variants: model.variants } : {}),
        },
      ]),
    ),
  }
}

export function sanitizeCustomProviderConfig(provider: unknown): { value: SanitizedProviderConfig } | Issue {
  const result = CustomProviderConfigSchema.safeParse(provider)
  if (!result.success) {
    const issue = result.error.issues[0]
    return fail(issue?.message ?? "Invalid custom provider config", issue)
  }

  return { value: normalizeCustomProviderConfig(result.data) }
}

type AnyRecord = Record<string, unknown>
type VariantPatch = Partial<{ [Key in keyof VariantConfig]: VariantConfig[Key] | null }>
type LimitPatch = { context: number; input?: number; output: number }
type CostPatch = { input: number; output: number; cache_read?: number; cache_write?: number }
type HeaderPatch = Record<string, string | null>
type ResetPatch = { models: Record<string, { variants?: Record<string, null>; limit?: null; cost?: null }> }
type ProviderPatch = Omit<SanitizedProviderConfig, "env" | "models" | "options"> & {
  env?: string[] | null
  options: {
    baseURL: string
    headers?: HeaderPatch | null
  }
  models: Record<
    string,
    null | {
      name: string
      reasoning?: true | null
      modalities?: ModelModalities | null
      variants?: Record<string, VariantConfig | VariantPatch | null>
      limit?: LimitPatch | null
      cost?: CostPatch | null
    }
  >
}

function isRecord(v: unknown): v is AnyRecord {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function same(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, i) => item === right[i])
}

function nulls(keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, null])) as Record<string, null>
}

function resetNeeded(old: unknown, next: unknown) {
  if (!isRecord(old) || !isRecord(next)) return false
  return Object.keys(old).some((key) => !(key in next))
}

function cleanPatch<T extends AnyRecord>(next: unknown): T | undefined {
  return isRecord(next) ? (next as T) : undefined
}

function recordPatch<T extends AnyRecord>(old: unknown, next: unknown): T | undefined {
  if (!isRecord(old)) return isRecord(next) ? (next as T) : undefined
  const patch = isRecord(next) ? (next as T) : undefined
  const removed = Object.keys(old).filter((key) => !(key in (patch ?? {})))
  if (removed.length === 0) return patch
  return { ...patch, ...Object.fromEntries(removed.map((key) => [key, null])) } as T
}

function variantPatch(
  oldModel: AnyRecord,
  newModel: AnyRecord,
): Record<string, VariantConfig | VariantPatch | null> | undefined {
  const oldVariants = isRecord(oldModel.variants) ? oldModel.variants : {}
  const newVariants = isRecord(newModel.variants) ? newModel.variants : {}
  const changes: Record<string, VariantPatch | null> = {}
  for (const [name, oldVariant] of Object.entries(oldVariants)) {
    if (!(name in newVariants)) {
      changes[name] = null
      continue
    }
    const item = newVariants[name]
    if (!isRecord(oldVariant) || !isRecord(item)) continue
    const removed = Object.keys(oldVariant).filter((key) => !(key in item))
    if (removed.length === 0) continue
    const nulls = Object.fromEntries(removed.map((key) => [key, null]))
    changes[name] = { ...item, ...nulls } as VariantPatch
  }
  if (Object.keys(changes).length === 0)
    return isRecord(newModel.variants)
      ? (newModel.variants as Record<string, VariantConfig | VariantPatch | null>)
      : undefined
  return { ...newVariants, ...changes } as Record<string, VariantConfig | VariantPatch | null>
}

function limitPatch(oldModel: AnyRecord, newModel: AnyRecord) {
  return cleanPatch<LimitPatch>(newModel.limit)
}

function costPatch(oldModel: AnyRecord, newModel: AnyRecord) {
  return cleanPatch<CostPatch>(newModel.cost)
}

function envPatch(existing: AnyRecord, next: SanitizedProviderConfig) {
  if (Array.isArray(existing.env) && next.env === undefined) return null
  return next.env
}

function optionsPatch(existing: AnyRecord, next: SanitizedProviderConfig): ProviderPatch["options"] {
  const oldOptions = isRecord(existing.options) ? existing.options : {}
  const headers = recordPatch<HeaderPatch>(oldOptions.headers, next.options.headers)
  return {
    ...next.options,
    ...(headers ? { headers } : {}),
    ...("headers" in oldOptions && next.options.headers === undefined ? { headers: null } : {}),
  }
}

export function providerReset(existing: unknown, next: SanitizedProviderConfig): ResetPatch | undefined {
  if (!isRecord(existing)) return undefined
  const old = isRecord(existing.models) ? existing.models : {}
  const models: ResetPatch["models"] = {}

  for (const [id, model] of Object.entries(next.models)) {
    const prev = old[id]
    if (!isRecord(prev)) continue
    const reset: ResetPatch["models"][string] = {}
    if (isRecord(prev.variants) && model.variants) {
      const before = Object.keys(prev.variants)
      const after = Object.keys(model.variants)
      if (before.length > 0 && after.length > 0 && !same(before, after)) reset.variants = nulls(before)
    }
    if (resetNeeded(prev.limit, model.limit)) reset.limit = null
    if (resetNeeded(prev.cost, model.cost)) reset.cost = null
    if (Object.keys(reset).length > 0) models[id] = reset
  }

  if (Object.keys(models).length === 0) return undefined
  return { models }
}

/**
 * Build a provider patch that includes null sentinels for model properties,
 * variants, and variant options that existed in the previous config but are
 * absent from the new one. The CLI `config.update` endpoint deep-merges the
 * payload with the existing config; without explicit nulls, removed entries
 * would persist on disk.
 */
export function withCustomProviderDeletions(existing: unknown, next: SanitizedProviderConfig): ProviderPatch {
  if (!isRecord(existing)) return next
  const oldModels = isRecord(existing.models) ? existing.models : {}
  const env = envPatch(existing, next)
  const patched: ProviderPatch["models"] = { ...next.models }

  for (const id of Object.keys(oldModels)) {
    if (!(id in patched)) {
      patched[id] = null
      continue
    }
    const oldModel = oldModels[id]
    const newModel = patched[id]
    if (!isRecord(oldModel) || !isRecord(newModel)) continue
    const variants = variantPatch(oldModel, newModel)
    const limit = limitPatch(oldModel, newModel)
    const cost = costPatch(oldModel, newModel)
    patched[id] = {
      ...newModel,
      ...(variants ? { variants } : {}),
      ...(limit ? { limit } : {}),
      ...(cost ? { cost } : {}),
      ...(oldModel.reasoning !== undefined && newModel.reasoning === undefined ? { reasoning: null } : {}),
      ...(oldModel.modalities !== undefined && newModel.modalities === undefined ? { modalities: null } : {}),
      ...(oldModel.limit !== undefined && newModel.limit === undefined ? { limit: null } : {}),
      ...(oldModel.cost !== undefined && newModel.cost === undefined ? { cost: null } : {}),
    }
  }

  return {
    ...next,
    ...(env === undefined ? {} : { env }),
    options: optionsPatch(existing, next),
    models: patched,
  }
}
