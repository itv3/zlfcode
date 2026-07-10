import type { Provider, ProviderModel } from "../../types/messages"
import { customProviderCatalog, type CustomProviderPackage } from "../../../../src/shared/provider-model"
import type {
  ChatTemplateArgsValue,
  ModelEntry,
  OutputEffortValue,
  ReasoningEffortValue,
  ThinkingTypeValue,
  VariantEntry,
} from "./CustomProviderModelCard"

export type CustomProviderDefaults = {
  image?: boolean
  reasoning?: boolean
  contextLimit?: number
  outputLimit?: number
  inputCost?: number
  outputCost?: number
  cacheReadCost?: number
  cacheWriteCost?: number
  variants?: Record<string, Record<string, unknown>>
}

export type DefaultCandidate = {
  providerID: string
  modelID: string
  name: string
  defaults: CustomProviderDefaults
}

const FALLBACKS: Record<string, string> = {
  "claude-opus-4-8": "claude-opus-4-7",
}

const PROVIDERS: Record<CustomProviderPackage, string[]> = {
  "@ai-sdk/openai-compatible": ["zhipuai", "zai", "opencode", "llmgateway", "openrouter"],
  "@ai-sdk/openai": [],
  "@ai-sdk/anthropic": [],
  "@ai-sdk/google": [],
}

const TAILS = new Set(["thinking", "reasoning", "low", "medium", "high", "xhigh", "max", "minimal", "none"])
// 候选模型打分权重:精确/前缀/尾缀权重大于普通 token 命中,避免低相关模型挤到前面。
const SCORE = {
  hit: 30,
  coverage: 80,
  density: 30,
  order: 8,
  tail: 60,
  exact: 120,
  prefix: 40,
  cutoff: 120,
} as const

function text(value: number | undefined) {
  return value === undefined ? "" : String(value)
}

function flag(current: boolean, value: boolean | undefined) {
  if (value === undefined || current) return current
  return value
}

function field(current: string, value: number | undefined) {
  if (value === undefined || current.trim()) return current
  return text(value)
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function rest(value: unknown, key: string) {
  const item = record(value)
  if (!item) return undefined
  const next = { ...item }
  delete next[key]
  return Object.keys(next).length > 0 ? next : undefined
}

export function parseVariant([name, cfg]: [string, Record<string, unknown>]): VariantEntry {
  const extras = { ...cfg }
  delete extras.enable_thinking
  delete extras.reasoning_split
  delete extras.reasoningEffort
  delete extras.effort
  const thinking = rest(cfg.thinking, "type")
  const args = rest(cfg.chat_template_args, "enable_thinking")
  if (thinking) extras.thinking = thinking
  else delete extras.thinking
  if (args) extras.chat_template_args = args
  else delete extras.chat_template_args

  return {
    name,
    extras: Object.keys(extras).length > 0 ? extras : undefined,
    enableThinking: typeof cfg.enable_thinking === "boolean" ? cfg.enable_thinking : undefined,
    thinking:
      typeof cfg.thinking === "object" && cfg.thinking !== null
        ? ((cfg.thinking as { type?: string }).type as ThinkingTypeValue)
        : undefined,
    splitReasoning: typeof cfg.reasoning_split === "boolean" ? cfg.reasoning_split : undefined,
    reasoningEffort:
      typeof cfg.reasoningEffort === "string" ? (cfg.reasoningEffort as ReasoningEffortValue) : undefined,
    outputEffort: typeof cfg.effort === "string" ? (cfg.effort as OutputEffortValue) : undefined,
    chatTemplateArgs:
      typeof cfg.chat_template_args === "object" && cfg.chat_template_args !== null
        ? ((cfg.chat_template_args as { enable_thinking?: boolean }).enable_thinking as ChatTemplateArgsValue)
        : undefined,
  }
}

export function parseDefaults(defaults: CustomProviderDefaults) {
  return Object.entries(defaults.variants ?? {})
    .map(parseVariant)
    .filter(
      (item) =>
        item.enableThinking !== undefined ||
        item.thinking !== undefined ||
        item.splitReasoning !== undefined ||
        item.reasoningEffort !== undefined ||
        item.outputEffort !== undefined ||
        item.chatTemplateArgs !== undefined ||
        item.extras !== undefined,
    )
}

export function mergeModelDefaults(model: ModelEntry, defaults: CustomProviderDefaults): ModelEntry {
  const variants = parseDefaults(defaults)
  const prices = [defaults.inputCost, defaults.outputCost, defaults.cacheReadCost, defaults.cacheWriteCost]
  const priced = prices.some((value) => value !== undefined)
  const reasoning = variants.length > 0 ? true : flag(model.reasoning, defaults.reasoning)

  return {
    ...model,
    supportsImages: flag(model.supportsImages, defaults.image),
    reasoning,
    contextLimit: field(model.contextLimit, defaults.contextLimit),
    outputLimit: field(model.outputLimit, defaults.outputLimit),
    costEnabled: priced || model.costEnabled,
    inputCost: field(model.inputCost, defaults.inputCost),
    outputCost: field(model.outputCost, defaults.outputCost),
    cacheReadCost: field(model.cacheReadCost, defaults.cacheReadCost),
    cacheWriteCost: field(model.cacheWriteCost, defaults.cacheWriteCost),
    variants: variants.length > 0 && model.variants.length === 0 ? variants : model.variants,
  }
}

export function replaceModelDefaults(model: ModelEntry, defaults: CustomProviderDefaults): ModelEntry {
  const variants = parseDefaults(defaults)
  const prices = [defaults.inputCost, defaults.outputCost, defaults.cacheReadCost, defaults.cacheWriteCost]

  return {
    ...model,
    supportsImages: defaults.image ?? false,
    reasoning: variants.length > 0 || (defaults.reasoning ?? false),
    contextLimit: text(defaults.contextLimit),
    outputLimit: text(defaults.outputLimit),
    costEnabled: prices.some((value) => value !== undefined),
    inputCost: text(defaults.inputCost),
    outputCost: text(defaults.outputCost),
    cacheReadCost: text(defaults.cacheReadCost),
    cacheWriteCost: text(defaults.cacheWriteCost),
    variants,
  }
}

export function catalogDefaults(model: ProviderModel | undefined): CustomProviderDefaults {
  if (!model) return {}
  const variants = model.variants && Object.keys(model.variants).length > 0 ? model.variants : undefined
  return {
    image: model.capabilities?.input?.image,
    reasoning: model.capabilities?.reasoning,
    contextLimit: model.limit?.context,
    outputLimit: model.limit?.output,
    inputCost: model.cost?.input,
    outputCost: model.cost?.output,
    cacheReadCost: model.cost?.cache?.read,
    cacheWriteCost: model.cost?.cache?.write,
    variants,
  }
}

function useful(value: CustomProviderDefaults) {
  return Object.entries(value).some(([key, item]) => {
    if (key === "variants") return typeof item === "object" && item !== null && Object.keys(item).length > 0
    return item !== undefined
  })
}

function add(list: string[], key: string | undefined) {
  if (!key || list.includes(key)) return
  list.push(key)
}

function bare(id: string) {
  return id.split("/").at(-1) ?? id
}

function parts(id: string) {
  return bare(id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .split("-")
    .filter(Boolean)
}

function compact(list: string[]) {
  return list.filter((item) => item !== "preview").join("-")
}

function ordered(query: string[], target: string[]) {
  const count = query.reduce(
    (state, item) => {
      const pos = target.slice(state.at).indexOf(item)
      if (pos < 0) return state
      return { at: state.at + pos + 1, count: state.count + 1 }
    },
    { at: 0, count: 0 },
  )
  return count.count
}

function score(query: string, id: string) {
  const q = parts(query)
  const t = parts(id)
  if (q.length === 0 || t.length === 0) return 0
  const bag = new Set(t)
  const hit = q.filter((item) => bag.has(item))
  const last = q.at(-1)
  const tail = last && TAILS.has(last) && t.includes(last) ? SCORE.tail : 0
  const order = ordered(q, t)
  const exact = compact(q) === compact(t) ? SCORE.exact : 0
  const prefix = compact(t).startsWith(compact(q)) || compact(q).startsWith(compact(t)) ? SCORE.prefix : 0
  return (
    hit.length * SCORE.hit +
    (hit.length / q.length) * SCORE.coverage +
    (hit.length / t.length) * SCORE.density +
    order * SCORE.order +
    tail +
    exact +
    prefix
  )
}

export function defaultKeys(id: string) {
  const list: string[] = []
  const base = [id, bare(id)]
  for (const key of base) {
    add(list, key)
  }
  for (const key of [...list]) add(list, FALLBACKS[key])
  return list
}

function ids(providers: Record<string, Provider>, npm: CustomProviderPackage, discovered = true) {
  const seen = new Set<string>()
  const list = [customProviderCatalog(npm), ...PROVIDERS[npm], ...(discovered ? Object.keys(providers) : [])]
  return list.filter((id) => {
    if (seen.has(id) || !providers[id]) return false
    seen.add(id)
    return true
  })
}

function match(models: Record<string, ProviderModel>, keys: string[]) {
  for (const key of keys) {
    const model = models[key]
    if (model) return model
  }

  const lower = new Map(Object.keys(models).map((id) => [id.toLowerCase(), id]))
  for (const key of keys) {
    const id = lower.get(key.toLowerCase())
    const model = id ? models[id] : undefined
    if (model) return model
  }
}

export function defaultsForModel(providers: Record<string, Provider>, npm: CustomProviderPackage, id: string) {
  const keys = defaultKeys(id)
  for (const pid of ids(providers, npm, false)) {
    const model = match(providers[pid]!.models, keys)
    if (model) return catalogDefaults(model)
  }
  return {}
}

export function defaultCandidates(
  providers: Record<string, Provider>,
  npm: CustomProviderPackage,
  id: string,
  limit = 5,
  opts: { excludeProviders?: string[]; excludeModels?: string[] } = {},
): DefaultCandidate[] {
  if (parts(id).length < 3) return []
  const seen = new Set<string>()
  const excluded = new Set((opts.excludeProviders ?? []).map((item) => item.toLowerCase()))
  const models = new Set((opts.excludeModels ?? []).map((item) => item.toLowerCase()))
  return ids(providers, npm)
    .filter((pid) => !excluded.has(pid.toLowerCase()))
    .flatMap((pid, pi) =>
      Object.entries(providers[pid]!.models).map(([mid, model]) => ({
        pid,
        mid,
        model,
        rank: pi,
        score: Math.max(score(id, mid), score(id, model.id), score(id, model.name)),
      })),
    )
    .filter((item) => !models.has(item.mid.toLowerCase()) && !models.has(`${item.pid}/${item.mid}`.toLowerCase()))
    .filter((item) => item.score > SCORE.cutoff)
    .map((item) => ({ ...item, defaults: catalogDefaults(item.model) }))
    .filter((item) => useful(item.defaults))
    .sort((a, b) => b.score - a.score || a.rank - b.rank || a.mid.localeCompare(b.mid))
    .filter((item) => {
      const key = `${item.pid}/${item.mid}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
    .map((item) => ({
      providerID: item.pid,
      modelID: item.mid,
      name: item.model.name,
      defaults: item.defaults,
    }))
}

export function hasDefaults(value: CustomProviderDefaults) {
  return useful(value)
}
