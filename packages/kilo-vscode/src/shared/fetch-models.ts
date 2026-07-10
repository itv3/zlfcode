import type { CustomProviderProtocol } from "./provider-model"
import { FETCH_MODELS_TIMEOUT_MS } from "./fetch-models-timeout"

export type FetchModelsProtocol = CustomProviderProtocol

const MAX_RESPONSE_BYTES = 2_000_000

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

async function body(response: Response) {
  const len = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(len) && len > MAX_RESPONSE_BYTES) {
    throw new FetchModelsError("Model response is too large", response.status)
  }

  if (!response.body) return response.text()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    size += item.value.byteLength
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch((err) => console.warn("Failed to cancel oversized model response", err))
      throw new FetchModelsError("Model response is too large", response.status)
    }
    chunks.push(item.value)
  }

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

async function request(url: string, headers: Record<string, string>) {
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
    return JSON.parse(await body(response))
  } catch (err) {
    if (err instanceof FetchModelsError) throw err
    throw new FetchModelsError("Invalid model response", response.status)
  }
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

function anthropicModelsURL(baseURL: string) {
  const url = baseURL.replace(/\/+$/, "")
  if (/\/v1$/i.test(url)) return `${url}/models`
  return `${url}/v1/models`
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
  const url = anthropicModelsURL(opts.baseURL)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["x-api-key"] = opts.apiKey
  }

  const data = (await request(url, headers)) as { data?: Array<Record<string, unknown>> }
  const items = data?.data
  if (!Array.isArray(items)) return []

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

async function fetchGeminiModels(opts: Options): Promise<ModelEntry[]> {
  const url = opts.baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["x-goog-api-key"] = opts.apiKey
  }

  const data = (await request(url, headers)) as { models?: Array<Record<string, unknown>> }
  const items = data?.models
  if (!Array.isArray(items)) return []

  return unique(
    items.map((item) => {
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
  if (opts.protocol === "anthropic") return fetchAnthropicModels(opts)
  if (opts.protocol === "gemini") return fetchGeminiModels(opts)
  return fetchOpenAIModels(opts)
}
