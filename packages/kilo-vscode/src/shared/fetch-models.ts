import type { CustomProviderProtocol } from "./provider-model"
import { normalizeProtocolBaseURL } from "./provider-model"
import { FETCH_MODELS_TIMEOUT_MS } from "./fetch-models-timeout"

export type FetchModelsProtocol = CustomProviderProtocol

const MAX_RESPONSE_BYTES = 2_000_000
// 分页拉取的最大页数保护:防止恶意或异常 endpoint 通过永远返回
// has_more=true / nextPageToken 让循环无限进行。10 页 × 每页 1000 条
// 已远超真实模型目录规模,正常场景不会触达上限。
const MAX_FETCH_PAGES = 10

type Options = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  protocol: FetchModelsProtocol
}
type OpenAIOptions = Omit<Options, "protocol">

type ModelEntry = {
  id: string
  name: string
  contextLimit?: number
  outputLimit?: number
  inputCost?: number
  outputCost?: number
  cacheReadCost?: number
  cacheWriteCost?: number
}

export class FetchModelsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = "FetchModelsError"
  }

  get auth() {
    return this.status === 401 || this.status === 403
  }
}

function limit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function num(value: unknown) {
  const n = typeof value === "string" && value.trim() ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined
}

function perMillion(value: unknown) {
  const n = num(value)
  // Some OpenAI-compatible catalogs expose per-token prices; Kilo stores per-million-token prices.
  return n === undefined ? undefined : n * 1_000_000
}

function trim(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function cost(item: Record<string, unknown>): Partial<ModelEntry> {
  const cfg = record(item.cost)
  const pricing = record(item.pricing)
  const input =
    num(cfg.input) ??
    perMillion(pricing.prompt) ??
    perMillion(item.input_cost_per_token) ??
    perMillion(item.prompt_cost_per_token)
  const output =
    num(cfg.output) ??
    perMillion(pricing.completion) ??
    perMillion(item.output_cost_per_token) ??
    perMillion(item.completion_cost_per_token)
  const cacheRead =
    num(cfg.cache_read) ??
    perMillion(pricing.input_cache_read) ??
    perMillion(item.cache_read_cost_per_token) ??
    perMillion(item.input_cache_read_cost_per_token)
  const cacheWrite =
    num(cfg.cache_write) ??
    perMillion(pricing.input_cache_write) ??
    perMillion(item.cache_write_cost_per_token) ??
    perMillion(item.input_cache_write_cost_per_token)
  return {
    ...(input !== undefined ? { inputCost: input } : {}),
    ...(output !== undefined ? { outputCost: output } : {}),
    ...(cacheRead !== undefined ? { cacheReadCost: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWriteCost: cacheWrite } : {}),
  }
}

// 响应体字节预算:单次发现流程(含分页的多次请求)共享同一份预算,
// 使 2MB 上限对分页拉取按"累计字节数"生效,而不是每页各自 2MB。
type ByteBudget = { remaining: number }

function newByteBudget(): ByteBudget {
  return { remaining: MAX_RESPONSE_BYTES }
}

async function body(response: Response, budget: ByteBudget) {
  const len = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(len) && len > budget.remaining) {
    throw new FetchModelsError("Model response is too large", response.status)
  }

  if (!response.body) {
    const text = await response.text()
    // 无法流式读取时退化为整体读取,读完后再检查并扣减预算。
    const size = new TextEncoder().encode(text).byteLength
    if (size > budget.remaining) {
      throw new FetchModelsError("Model response is too large", response.status)
    }
    budget.remaining -= size
    return text
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    size += item.value.byteLength
    if (size > budget.remaining) {
      await reader.cancel().catch((err) => console.warn("Failed to cancel oversized model response", err))
      throw new FetchModelsError("Model response is too large", response.status)
    }
    chunks.push(item.value)
  }
  budget.remaining -= size

  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function timeout(err: unknown) {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return err.name === "TimeoutError" || (err.name === "AbortError" && msg.includes("timeout"))
}

async function request(url: string, headers: Record<string, string>, budget: ByteBudget = newByteBudget()) {
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_MODELS_TIMEOUT_MS),
  }).catch((err) => {
    if (timeout(err)) throw new FetchModelsError("Timed out")
    throw err
  })

  if (!response.ok) {
    throw new FetchModelsError(`HTTP ${response.status}`, response.status)
  }

  try {
    return JSON.parse(await body(response, budget))
  } catch (err) {
    if (err instanceof FetchModelsError) throw err
    throw new FetchModelsError("Invalid model response", response.status)
  }
}

// 在 /models endpoint URL 上追加分页查询参数。
// 注意（F70）：baseURL 只经过 webview 的弱正则与扩展端的 typeof 检查，并没有
// 完整的 URL schema 校验，new URL 对畸形输入会抛出原生 TypeError。这里统一
// 转成 FetchModelsError，调用方 catch 后回发 webview 的错误文案保持语义化。
function pagedURL(modelsURL: string, params: Record<string, string | undefined>) {
  const url = (() => {
    try {
      return new URL(modelsURL)
    } catch {
      throw new FetchModelsError("Invalid base URL")
    }
  })()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value)
  }
  return url.toString()
}

function sort(models: ModelEntry[]) {
  return models.sort((a, b) => a.id.localeCompare(b.id))
}

function unique(models: ModelEntry[]) {
  const seen = new Set<string>()
  const result: ModelEntry[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    result.push(model)
  }
  return sort(result)
}

export async function fetchOpenAIModels(opts: OpenAIOptions): Promise<ModelEntry[]> {
  const url = opts.baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`
  }

  const data = (await request(url, headers)) as { data?: Array<Record<string, unknown>> }
  const items = data?.data
  if (!Array.isArray(items)) return []

  return unique(
    items.map((item) => {
      const id = trim(item.id)
      const name = trim(item.name) || id
      return {
        id,
        name,
        contextLimit: limit(item.context_length),
        outputLimit: limit(item.max_output_tokens),
        ...cost(item),
      }
    }),
  )
}

async function fetchAnthropicModels(opts: Options): Promise<ModelEntry[]> {
  // baseURL 已在 fetchModels 入口规范化为以 /v1 结尾,这里只做纯 /models 拼接。
  const modelsURL = opts.baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["x-api-key"] = opts.apiKey
  }

  // Anthropic /v1/models 默认每页仅 20 条,通过 has_more/last_id 分页。
  // 显式请求 API 上限 limit=1000,并跟随 after_id 循环合并所有页,
  // 避免大模型目录(尤其是第三方兼容网关)被静默截断。
  const items: Array<Record<string, unknown>> = []
  const budget = newByteBudget()
  let afterID: string | undefined
  for (let page = 0; page < MAX_FETCH_PAGES; page++) {
    const url = pagedURL(modelsURL, { limit: "1000", after_id: afterID })
    const data = (await request(url, headers, budget)) as {
      data?: Array<Record<string, unknown>>
      has_more?: unknown
      last_id?: unknown
    }
    const pageItems = Array.isArray(data?.data) ? data.data : []
    items.push(...pageItems)
    const lastID = typeof data?.last_id === "string" && data.last_id ? data.last_id : undefined
    // 结束条件:显式 has_more!==true、缺少游标、空页,或游标未推进(防御异常 endpoint 死循环)。
    if (data?.has_more !== true || !lastID || pageItems.length === 0 || lastID === afterID) break
    afterID = lastID
  }
  if (items.length === 0) return []

  return unique(
    items.map((item) => {
      const id = trim(item.id)
      const name = trim(item.display_name) || trim(item.name) || id
      return {
        id,
        name,
        contextLimit: limit(item.context_window),
        outputLimit: limit(item.max_output_tokens),
        ...cost(item),
      }
    }),
  )
}

// Gemini 模型条目是否支持聊天:目录里混有 embedding / imagen / veo / tts 等
// 不支持 generateContent 的模型,添加后要到真正发聊天请求时才失败,
// 因此在发现阶段就按 supportedGenerationMethods 过滤掉。
// 字段缺失或格式异常时保守放行,兼容不返回该字段的非官方网关。
function geminiChatCapable(item: Record<string, unknown>) {
  const methods = item.supportedGenerationMethods
  if (!Array.isArray(methods)) return true
  return methods.includes("generateContent") || methods.includes("streamGenerateContent")
}

async function fetchGeminiModels(opts: Options): Promise<ModelEntry[]> {
  // baseURL 已在 fetchModels 入口规范化(缺版本段时补 /v1beta),这里只做纯 /models 拼接。
  const modelsURL = opts.baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["x-goog-api-key"] = opts.apiKey
  }

  // Gemini /models 默认每页仅 50 条,通过 nextPageToken 分页。
  // 显式请求 pageSize=1000 并跟随 pageToken 循环合并所有页。
  const items: Array<Record<string, unknown>> = []
  const budget = newByteBudget()
  let pageToken: string | undefined
  for (let page = 0; page < MAX_FETCH_PAGES; page++) {
    const url = pagedURL(modelsURL, { pageSize: "1000", pageToken })
    const data = (await request(url, headers, budget)) as {
      models?: Array<Record<string, unknown>>
      nextPageToken?: unknown
    }
    const pageItems = Array.isArray(data?.models) ? data.models : []
    items.push(...pageItems)
    const next = typeof data?.nextPageToken === "string" && data.nextPageToken ? data.nextPageToken : undefined
    // 结束条件:空页(与 Anthropic 分支对称,防止异常 endpoint 用不断变化的
    // token 配空结果让循环空转拉满上限页数,F64)、没有下一页 token,
    // 或 token 未变化(防御异常 endpoint 死循环)。
    if (pageItems.length === 0 || !next || next === pageToken) break
    pageToken = next
  }
  if (items.length === 0) return []

  return unique(
    items.filter(geminiChatCapable).map((item) => {
      const raw = trim(item.name)
      const id = raw.replace(/^models\//, "")
      const name = trim(item.displayName) || id
      return {
        id,
        name,
        contextLimit: limit(item.inputTokenLimit),
        outputLimit: limit(item.outputTokenLimit),
        ...cost(item),
      }
    }),
  )
}

export async function fetchModels(opts: Options): Promise<ModelEntry[]> {
  // 入口统一按协议做 baseURL 防御性规范化(anthropic 补 /v1、gemini 补 /v1beta),
  // 与 webview 侧 normalizeCustomProviderBaseURL 的规则保持一致且幂等。
  // 这样即使未来新增的调用方漏掉规范化,发现请求也不会打到错误路径。
  const normalized: Options = { ...opts, baseURL: normalizeProtocolBaseURL(opts.protocol, opts.baseURL) }
  if (normalized.protocol === "anthropic") return fetchAnthropicModels(normalized)
  if (normalized.protocol === "gemini") return fetchGeminiModels(normalized)
  return fetchOpenAIModels(normalized)
}
