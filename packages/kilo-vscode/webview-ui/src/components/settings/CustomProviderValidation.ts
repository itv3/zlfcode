import { normalizeCustomProviderBaseURL, type CustomProviderPackage } from "../../../../src/shared/provider-model"
import type { Modalities, ModelEntry, VariantEntry } from "./CustomProviderModelCard"

type Translator = (key: string, params?: Record<string, string>) => string

export type HeaderRow = {
  key: string
  value: string
}

export type FormState = {
  providerID: string
  name: string
  npm: CustomProviderPackage
  baseURL: string
  apiKey: string
  models: ModelEntry[]
  headers: HeaderRow[]
  saving: boolean
}

export type FormErrors = {
  providerID: string | undefined
  name: string | undefined
  baseURL: string | undefined
  models: Array<{
    id?: string
    name?: string
    contextLimit?: string
    outputLimit?: string
    inputCost?: string
    outputCost?: string
    cacheReadCost?: string
    cacheWriteCost?: string
    variants?: Array<{ name?: string }>
  }>
  headers: Array<{ key?: string; value?: string }>
}

type ValidateArgs = {
  form: FormState
  t: Translator
  editing: boolean
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  /** Preserved env vars from the existing provider config (edit mode only) */
  existingEnv?: string[]
}

type ValidateResult = {
  errors: FormErrors
  result?: {
    providerID: string
    name: string
    key: string | undefined
    config: {
      npm: CustomProviderPackage
      name: string
      env?: string[]
      options: { baseURL: string; headers?: Record<string, string> }
      models: Record<string, unknown>
    }
  }
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
function checkVariant(v: VariantEntry, seen: Set<string>, t: Translator) {
  const n = v.name.trim()
  if (!n) return { name: t("provider.custom.error.required") }
  if (seen.has(n)) return { name: t("provider.custom.error.duplicate") }
  seen.add(n)
  return { name: undefined }
}

function checkLimit(value: string, t: Translator) {
  const raw = value.trim()
  if (!raw) return undefined
  const num = Number(raw)
  if (/^\d+$/.test(raw) && Number.isSafeInteger(num) && num > 0) return undefined
  return t("provider.custom.error.tokenLimit")
}

function checkCost(value: string, t: Translator) {
  const raw = value.trim()
  if (!raw) return undefined
  const num = Number(raw)
  if (Number.isFinite(num) && num >= 0) return undefined
  return t("provider.custom.error.cost")
}

function checkModel(m: ModelEntry, seenModels: Set<string>, t: Translator) {
  const id = m.id.trim()
  const key = id.toLowerCase()
  let idErr: string | undefined
  if (!id) idErr = t("provider.custom.error.required")
  else if (seenModels.has(key)) idErr = t("provider.custom.error.duplicate")
  else seenModels.add(key)

  const nameErr = !m.name.trim() ? t("provider.custom.error.required") : undefined
  const context = m.contextLimit.trim()
  const output = m.outputLimit.trim()
  const contextLimitErr =
    checkLimit(m.contextLimit, t) ?? (!context && output ? t("provider.custom.error.required") : undefined)
  const outputLimitErr =
    checkLimit(m.outputLimit, t) ?? (context && !output ? t("provider.custom.error.required") : undefined)
  const input = m.inputCost.trim()
  const costOutput = m.outputCost.trim()
  const inputCostErr = m.costEnabled
    ? (checkCost(m.inputCost, t) ?? (!input ? t("provider.custom.error.required") : undefined))
    : undefined
  const outputCostErr = m.costEnabled
    ? (checkCost(m.outputCost, t) ?? (!costOutput ? t("provider.custom.error.required") : undefined))
    : undefined
  const cacheReadCostErr = m.costEnabled ? checkCost(m.cacheReadCost, t) : undefined
  const cacheWriteCostErr = m.costEnabled ? checkCost(m.cacheWriteCost, t) : undefined
  const seen = new Set<string>()
  const variants = m.reasoning ? m.variants.map((v) => checkVariant(v, seen, t)) : []
  return {
    id: idErr,
    name: nameErr,
    contextLimit: contextLimitErr,
    outputLimit: outputLimitErr,
    inputCost: inputCostErr,
    outputCost: outputCostErr,
    cacheReadCost: cacheReadCostErr,
    cacheWriteCost: cacheWriteCostErr,
    variants,
  }
}

function checkHeader(h: HeaderRow, seenKeys: Set<string>, t: Translator) {
  const key = h.key.trim()
  const value = h.value.trim()
  if (!key && !value) return {}

  let keyErr: string | undefined
  if (!key) keyErr = t("provider.custom.error.required")
  else if (seenKeys.has(key.toLowerCase())) keyErr = t("provider.custom.error.duplicate")
  else seenKeys.add(key.toLowerCase())

  const valueErr = !value ? t("provider.custom.error.required") : undefined
  return { key: keyErr, value: valueErr }
}

function checkProviderID(id: string, editing: boolean, disabled: string[], existing: Set<string>, t: Translator) {
  const idErr = !id
    ? t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(id)
      ? t("provider.custom.error.providerID.format")
      : undefined
  const existsErr =
    idErr || editing || !existing.has(id) || disabled.includes(id)
      ? undefined
      : t("provider.custom.error.providerID.exists")
  return { idErr, existsErr }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function serializeVariant(v: VariantEntry): [string, Record<string, unknown>] {
  const cfg: Record<string, unknown> = { ...(v.extras ?? {}) }
  if (v.enableThinking !== undefined) cfg.enable_thinking = v.enableThinking
  if (v.thinking !== undefined) cfg.thinking = { ...record(cfg.thinking), type: v.thinking }
  else delete cfg.thinking
  if (v.splitReasoning !== undefined) cfg.reasoning_split = v.splitReasoning
  if (v.reasoningEffort !== undefined) cfg.reasoningEffort = v.reasoningEffort
  if (v.outputEffort !== undefined) cfg.effort = v.outputEffort
  if (v.chatTemplateArgs !== undefined)
    cfg.chat_template_args = { ...record(cfg.chat_template_args), enable_thinking: v.chatTemplateArgs }
  else delete cfg.chat_template_args
  return [v.name.trim(), cfg]
}

function extractModelLimits(m: ModelEntry) {
  const context = m.contextLimit.trim() ? Number(m.contextLimit.trim()) : undefined
  const output = m.outputLimit.trim() ? Number(m.outputLimit.trim()) : undefined
  if (context !== undefined && output !== undefined) {
    return {
      context,
      output,
    }
  }
  return undefined
}

function extractModelCosts(m: ModelEntry) {
  if (!m.costEnabled) return undefined
  const parse = (value: string) => {
    const raw = value.trim()
    if (!raw) return undefined
    return Number(raw)
  }
  const inputCost = parse(m.inputCost)
  const outputCost = parse(m.outputCost)
  const cacheReadCost = parse(m.cacheReadCost)
  const cacheWriteCost = parse(m.cacheWriteCost)

  if (inputCost !== undefined && outputCost !== undefined) {
    return {
      input: inputCost,
      output: outputCost,
      ...(cacheReadCost !== undefined ? { cache_read: cacheReadCost } : {}),
      ...(cacheWriteCost !== undefined ? { cache_write: cacheWriteCost } : {}),
    }
  }
  return undefined
}

function modalities(m: ModelEntry): Modalities | undefined {
  const input = new Set(m.modalities.input ?? [])
  const existing = input.size > 0 || (m.modalities.output?.length ?? 0) > 0
  if (!existing && !m.supportsImages) return

  const image = input.has("image")
  const changed = image !== m.supportsImages
  if (m.supportsImages && !image) {
    input.add("text")
    input.add("image")
  }
  if (!m.supportsImages) input.delete("image")

  const include = input.size > 0 || (m.modalities.input !== undefined && !changed)
  if (!include && !m.modalities.output?.length) return

  return {
    ...(include ? { input: [...input] } : {}),
    ...(m.modalities.output?.length ? { output: m.modalities.output } : {}),
  }
}

function serializeModel(m: ModelEntry): [string, Record<string, unknown>] {
  const ventries = m.reasoning ? m.variants.filter((v) => v.name.trim()).map(serializeVariant) : []
  const limit = extractModelLimits(m)
  const cost = extractModelCosts(m)
  const entry: Record<string, unknown> = { name: m.name.trim() }
  const modes = modalities(m)
  if (m.reasoning) entry.reasoning = true
  if (modes) entry.modalities = modes
  if (limit) entry.limit = limit
  if (cost) entry.cost = cost
  if (ventries.length > 0) entry.variants = Object.fromEntries(ventries)
  return [m.id.trim(), entry]
}

function resolveEnv(rawEnv: string | undefined, savedEnv: string[] | undefined) {
  if (rawEnv) return { env: [rawEnv] }
  if (savedEnv) return { env: savedEnv }
  return {}
}

export function validateCustomProvider(input: ValidateArgs): ValidateResult {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = normalizeCustomProviderBaseURL(input.form.npm, input.form.baseURL)
  const apiKey = input.form.apiKey.trim()

  const rawEnv = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  // When editing and apiKey is empty, preserve existing env from the original config
  const savedEnv = input.editing && !apiKey ? input.existingEnv : undefined
  const key = apiKey && !rawEnv ? apiKey : undefined

  const { idErr, existsErr } = checkProviderID(
    providerID,
    input.editing,
    input.disabledProviders,
    input.existingProviderIDs,
    input.t,
  )

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const seenModels = new Set<string>()
  const modelErrors = input.form.models.map((m) => checkModel(m, seenModels, input.t))
  const modelsValid = modelErrors.every(
    (m) =>
      !m.id &&
      !m.name &&
      !m.contextLimit &&
      !m.outputLimit &&
      !m.inputCost &&
      !m.outputCost &&
      !m.cacheReadCost &&
      !m.cacheWriteCost &&
      m.variants.every((v) => !v.name),
  )

  const seenHeaders = new Set<string>()
  const headerErrors = input.form.headers.map((h) => checkHeader(h, seenHeaders, input.t))
  const headersValid = headerErrors.every((h) => !h.key && !h.value)

  const errors: FormErrors = {
    providerID: idErr ?? existsErr,
    name: nameError,
    baseURL: urlError,
    models: modelErrors,
    headers: headerErrors,
  }

  const ok = !idErr && !existsErr && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { errors }

  const headers = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const options = {
    baseURL,
    ...(Object.keys(headers).length ? { headers } : {}),
  }

  return {
    errors,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: input.form.npm,
        name,
        ...resolveEnv(rawEnv, savedEnv),
        options,
        models: Object.fromEntries(input.form.models.map(serializeModel)),
      },
    },
  }
}
