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
        websocket: z.boolean().optional(),
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
    websocket?: true
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
      ...(config.options.websocket ? { websocket: true as const } : {}),
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
export type ResetPatch = { models: Record<string, { variants?: Record<string, null>; limit?: null; cost?: null }> }
export type ProviderPatch = Omit<SanitizedProviderConfig, "env" | "models" | "options"> & {
  env?: string[] | null
  options: {
    baseURL: string
    headers?: HeaderPatch | null
    websocket?: true | null
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

// 注意:limit/cost 的子字段删除(如旧 limit 有 input 而新 limit 没有)不在这里
// 用 null 哨兵表达,这两个函数只透传新值;子字段清理依赖调用方先应用
// providerReset 返回的整体 null 重置。详见 customProviderConfigPatches 的契约说明。
function limitPatch(newModel: AnyRecord) {
  return cleanPatch<LimitPatch>(newModel.limit)
}

function costPatch(newModel: AnyRecord) {
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
    ...("websocket" in oldOptions && next.options.websocket === undefined ? { websocket: null } : {}),
  }
}

/**
 * 生成"整体 null 重置"补丁:当模型的 variants 顺序变化,或 limit/cost 的
 * 子字段被删除时,返回把对应字段整体置 null 的补丁;无需重置时返回 undefined。
 *
 * 【成对调用契约】本函数与 withCustomProviderDeletions 必须成对使用:
 * 返回的重置补丁必须先于主补丁单独 config.update 一次(先清后写),
 * 否则 CLI 深合并会让被删除的 limit.input、cost.cache_read 等子字段残留在磁盘。
 * 推荐通过 customProviderConfigPatches 一次性获取两个补丁,避免漏配。
 */
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
 * 生成主补丁:对旧配置中存在、新配置中缺失的模型、模型属性、变体和变体选项
 * 写入 null 删除哨兵。CLI 的 `config.update` endpoint 会把载荷与既有配置深合并,
 * 缺少显式 null 时被删除的条目会残留在磁盘上。
 *
 * 【成对调用契约】limit/cost 的"子字段级"删除(如旧 limit 有 input 而新 limit
 * 没有)不由本函数表达——本函数只透传新的 limit/cost 值;子字段清理完全依赖
 * 调用方先应用 providerReset 返回的整体 null 重置(单独一次 config.update)。
 * 单独使用本函数会让被删除的 limit.input、cost.cache_read 等子字段在深合并后
 * 残留且不会有任何报错。推荐通过 customProviderConfigPatches 一次性获取两个补丁。
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
    const limit = limitPatch(newModel)
    const cost = costPatch(newModel)
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

/**
 * 保存自定义 provider 时使用的统一入口:一次性生成成对的两个补丁,
 * 把 providerReset 与 withCustomProviderDeletions 之间的隐式契约显式化。
 *
 * 应用顺序(调用方必须遵守):
 * 1. reset 存在时,先单独 config.update 应用 reset(把 variants/limit/cost 整体置 null,
 *    清掉旧配置里即将被删除的子字段);
 * 2. 再 config.update 应用 patch(写入新值与模型/属性级的 null 删除哨兵)。
 *
 * 两步都基于同一份 existing 快照生成;跳过第 1 步会让被删除的 limit.input、
 * cost.cache_read 等子字段在 CLI 深合并后残留在磁盘配置中。
 * 旧的两个导出仍保留以兼容既有调用方,新代码请优先使用本函数。
 */
export function customProviderConfigPatches(
  existing: unknown,
  next: SanitizedProviderConfig,
): { reset?: ResetPatch; patch: ProviderPatch } {
  const reset = providerReset(existing, next)
  return { ...(reset ? { reset } : {}), patch: withCustomProviderDeletions(existing, next) }
}
