import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Select } from "@kilocode/kilo-ui/select"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage, ProviderAuthState, ProviderConfig } from "../../types/messages"
import { createProviderAction } from "../../utils/provider-action"
import {
  CUSTOM_PROVIDER_PACKAGE,
  customProviderProtocol,
  isCustomProviderPackage,
  normalizeCustomProviderBaseURL,
  type CustomProviderPackage,
} from "../../../../src/shared/provider-model"
import { ModelCard } from "./CustomProviderModelCard"
import type { ChatTemplateArgsValue, ModelEntry, VariantEntry } from "./CustomProviderModelCard"
import { validateCustomProvider } from "./CustomProviderValidation"
import type { FormErrors, FormState, HeaderRow } from "./CustomProviderValidation"
import { prioritizeVariants } from "./CustomProviderVariants"
import {
  defaultCandidates,
  defaultsForModel,
  hasDefaults,
  mergeModelDefaults,
  parseDefaults,
  parseVariant,
  type CustomProviderDefaults,
  type DefaultCandidate,
} from "./CustomProviderDefaults"
const DEBOUNCE_MS = 500
const SEARCH_DEBOUNCE_MS = 150

const PACKAGE_OPTIONS: Array<{ value: CustomProviderPackage; label: string }> = [
  { value: "@ai-sdk/openai-compatible", label: "OpenAI Compatible" },
  { value: "@ai-sdk/openai", label: "OpenAI Responses" },
  { value: "@ai-sdk/anthropic", label: "Anthropic Messages" },
  { value: "@ai-sdk/google", label: "Gemini Native" },
]

/** 子序列模糊匹配,例如 "gpt4o" 可匹配 "gpt-4o-mini"。 */
function fuzzy(query: string, target: string) {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

function isPrivateHost(raw: string) {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^\[(.*)]$/, "$1")
    if (host === "localhost" || host.endsWith(".local") || host === "::1") return true
    const parts = host.split(".").map((part) => Number(part))
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
    const [a, b] = parts
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  } catch {
    return false
  }
}

type FetchedModel = {
  id: string
  name: string
  image?: boolean
  reasoning?: boolean
  contextLimit?: number
  outputLimit?: number
  inputCost?: number
  outputCost?: number
  cacheReadCost?: number
  cacheWriteCost?: number
}
type RawModel = {
  name?: string
  reasoning?: boolean
  modalities?: { input?: string[]; output?: string[] }
  limit?: { context?: number; input?: number; output?: number }
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
  variants?: Record<string, Record<string, unknown>>
}

function blankModel(): ModelEntry {
  return {
    id: "",
    name: "",
    image: false,
    outputModalities: ["text"],
    contextLimit: "",
    outputLimit: "",
    costEnabled: false,
    inputCost: "",
    outputCost: "",
    cacheReadCost: "",
    cacheWriteCost: "",
    reasoning: false,
    variants: [],
  }
}

function blankVariant(): VariantEntry {
  return {
    name: "",
    enableThinking: undefined,
    thinking: undefined,
    splitReasoning: undefined,
    reasoningEffort: undefined,
    outputEffort: undefined,
    chatTemplateArgs: undefined,
  }
}

function text(value: number | undefined) {
  return value === undefined ? "" : String(value)
}

function modelCost(raw: RawModel | undefined) {
  return (
    raw?.cost?.input !== undefined ||
    raw?.cost?.output !== undefined ||
    raw?.cost?.cache_read !== undefined ||
    raw?.cost?.cache_write !== undefined
  )
}

function initModels(cfg: ProviderConfig | undefined): ModelEntry[] {
  const blank = blankModel()
  if (!cfg?.models || typeof cfg.models !== "object") return [blank]
  const entries = Object.entries(cfg.models)
  if (entries.length === 0) return [blank]
  return entries.map(([id, model]) => {
    const raw = model as RawModel
    return {
      id,
      name: raw.name ?? id,
      image: raw.modalities?.input?.includes("image") ?? false,
      outputModalities: raw.modalities?.output ?? ["text"],
      contextLimit: text(raw.limit?.context),
      outputLimit: text(raw.limit?.output),
      costEnabled: modelCost(raw),
      inputCost: text(raw.cost?.input),
      outputCost: text(raw.cost?.output),
      cacheReadCost: text(raw.cost?.cache_read),
      cacheWriteCost: text(raw.cost?.cache_write),
      reasoning: raw.reasoning ?? false,
      variants: Object.entries(raw.variants ?? {}).map(parseVariant),
    }
  })
}

function initHeaders(cfg: ProviderConfig | undefined): HeaderRow[] {
  const opts = cfg?.options as { headers?: Record<string, string> } | undefined
  const headers = opts?.headers
  if (!headers || typeof headers !== "object") return [{ key: "", value: "" }]
  const entries = Object.entries(headers)
  if (entries.length === 0) return [{ key: "", value: "" }]
  return entries.map(([key, value]) => ({ key, value }))
}

type ExistingProvider = {
  providerID: string
  name: string
  config: ProviderConfig
}

function resolveAuth(existing: ExistingProvider | undefined, states: Record<string, ProviderAuthState>) {
  if (!existing || existing.config.env?.length) return
  return states[existing.providerID]
}

function initForm(existing: ExistingProvider | undefined): FormState {
  const npm = existing?.config?.npm
  return {
    providerID: existing?.providerID ?? "",
    name: existing?.name ?? "",
    npm: isCustomProviderPackage(npm) ? npm : CUSTOM_PROVIDER_PACKAGE,
    baseURL: (existing?.config?.options as { baseURL?: string } | undefined)?.baseURL ?? "",
    apiKey: "",
    models: initModels(existing?.config),
    headers: initHeaders(existing?.config),
    saving: false,
  }
}

export interface CustomProviderDialogProps {
  onBack?: () => void
  /** 传入后以编辑模式打开,并预填已有配置。 */
  existing?: ExistingProvider
}

const CustomProviderDialog = (props: CustomProviderDialogProps) => {
  const dialog = useDialog()
  const { config } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()
  const action = createProviderAction(vscode)
  onCleanup(action.dispose)

  const editing = () => !!props.existing

  const auth = resolveAuth(props.existing, provider.authStates())
  const [form, setForm] = createStore<FormState>(initForm(props.existing))

  const [errors, setErrors] = createStore<FormErrors>({
    providerID: undefined,
    name: undefined,
    baseURL: undefined,
    models: form.models.map((m) => ({ variants: m.variants.map(() => ({})) })),
    headers: form.headers.map(() => ({})),
  })
  const [apiTouched, setApiTouched] = createSignal(false)

  // ── 模型发现状态 ────────────────────────────────────────────────────

  const [fetching, setFetching] = createSignal(false)
  const [fetchError, setFetchError] = createSignal<string>()
  const [fetchedModels, setFetchedModels] = createSignal<FetchedModel[]>()
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  const [fetchStatus, setFetchStatus] = createSignal<string>()
  const [suggestion, setSuggestion] = createSignal<{
    index: number
    id: string
    items: ReturnType<typeof defaultCandidates>
  }>()
  const [preview, setPreview] = createSignal<{
    item: DefaultCandidate
    top: number
    left: number
  }>()
  const cleanups = new Set<() => void>()
  onCleanup(() => {
    for (const cleanup of cleanups) cleanup()
    cleanups.clear()
  })

  // 在已发现模型中搜索。
  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")

  createEffect(() => {
    const q = search()
    const timer = setTimeout(() => setDebouncedSearch(q), SEARCH_DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })

  const filtered = createMemo(() => {
    const models = fetchedModels()
    if (!models) return []
    const q = debouncedSearch()
    if (!q) return models
    return models.filter((m) => fuzzy(q, m.id) || fuzzy(q, m.name))
  })

  // ── 防抖自动发现 ────────────────────────────────────────────────────

  // 使用独立 signal 驱动 URL 和 API key 的自动发现。
  // 这里不在 createEffect 里直接读取 form.baseURL / form.apiKey,因为
  // SolidJS store proxy 会按属性追踪;任何 store 写入都可能让同一 store 上
  // 的 effect 重新运行,导致模型选择器被意外清空。
  const [fetchPackage, setFetchPackage] = createSignal(form.npm)
  const [fetchURL, setFetchURL] = createSignal(form.baseURL)
  const [fetchKey, setFetchKey] = createSignal("")
  let fetchVersion = 0

  createEffect(() => {
    void fetchPackage()
    const url = fetchURL()
    const key = fetchKey()
    void key // 只订阅 key 变化,这里不直接使用该值。

    // URL 或 key 变化时清空上一轮结果。
    setFetchedModels(undefined)
    setFetchError(undefined)
    setFetchStatus(undefined)
    setSearch("")

    fetchVersion++
    const version = fetchVersion
    if (!/^https?:\/\//.test(url.trim())) return

    const timer = setTimeout(() => {
      if (version === fetchVersion) doFetch()
    }, DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })

  // ── 模型发现核心逻辑 ────────────────────────────────────────────────

  function doFetch() {
    // 进入异步流程前先快照 signal/store 值。
    // 这样回调里不会继续读取 store proxy,避免订阅无关属性后形成重渲染循环。
    const url = normalizeCustomProviderBaseURL(fetchPackage(), fetchURL())
    const raw = fetchKey().trim()
    const envKey = /^\{env:[^}]+\}$/.test(raw)
    const apiKey = raw && !envKey ? raw : undefined
    // 编辑已有 provider 且 key 字段未改动时,webview 拿不到已保存 key。
    // key 在 provider 数据到达 webview 前已被剥离,因此发送 providerID,
    // 让扩展端用已保存 key 认证模型发现请求 (#10139)。用户手动输入的
    // key 优先级更高；{env:VAR} 必须先保存到 provider config,
    // 扩展端才会在 providerID/baseURL/protocol 都匹配时使用它。
    const providerID = !raw && props.existing ? props.existing.providerID : undefined
    const existing = new Set(form.models.map((m) => m.id.trim().toLowerCase()).filter(Boolean))

    const hdrs = form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
    const headers = hdrs.length > 0 ? Object.fromEntries(hdrs.map((h) => [h.key, h.value])) : undefined

    // 递增版本号,让上一轮仍在飞行中的响应被忽略。
    fetchVersion++
    const version = fetchVersion

    setFetching(true)
    setFetchError(undefined)
    setFetchedModels(undefined)
    setFetchStatus(isPrivateHost(url) ? language.t("provider.custom.models.fetch.privateHost") : undefined)
    setSearch("")
    setSuggestion(undefined)
    setPreview(undefined)

    const rid = crypto.randomUUID()

    let done = false
    let unsub = () => {}
    const cleanup = () => {
      if (done) return
      done = true
      clearTimeout(timeout)
      unsub()
      cleanups.delete(cleanup)
    }
    const timeout = setTimeout(() => {
      cleanup()
      if (version !== fetchVersion) return
      setFetching(false)
      setFetchError(language.t("provider.custom.models.fetch.error", { error: "Timed out" }))
    }, 16_000)
    cleanups.add(cleanup)

    unsub = vscode.onMessage((msg: ExtensionMessage) => {
      if (msg.type !== "customProviderModelsFetched") return
      if (!("requestId" in msg) || msg.requestId !== rid) return
      cleanup()

      // 过期响应:请求期间已经触发了更新的一轮发现。
      if (version !== fetchVersion) return

      setFetching(false)

      if (msg.error) {
        setFetchError(msg.auth ? language.t("provider.custom.models.fetch.authError") : msg.error)
        return
      }

      const models = msg.models ?? []
      if (models.length === 0) {
        setFetchError(language.t("provider.custom.models.fetch.empty"))
        return
      }

      // Filter using the snapshot taken at fetch time (trimmed, case-insensitive)
      const fresh = models.filter((m) => !existing.has(m.id.trim().toLowerCase()))

      if (fresh.length === 0) {
        setFetchStatus(language.t("provider.custom.models.fetch.allExist"))
        return
      }

      // 默认不选中，避免一次性误添加整组模型。
      setSelected(new Set<string>())
      setFetchedModels(fresh)
    })

    vscode.postMessage({
      type: "fetchCustomProviderModels",
      requestId: rid,
      baseURL: url,
      protocol: customProviderProtocol(fetchPackage()),
      apiKey,
      providerID,
      headers,
    })
  }

  function flag(i: number, key: "image" | "reasoning", value: boolean | undefined, current: boolean) {
    if (value !== undefined && !current) setForm("models", i, key, value)
  }

  function field(
    i: number,
    key: "contextLimit" | "outputLimit" | "inputCost" | "outputCost" | "cacheReadCost" | "cacheWriteCost",
    value: number | undefined,
    current: string,
  ) {
    if (value !== undefined && !current.trim()) setForm("models", i, key, text(value))
  }

  function apply(i: number, defaults: CustomProviderDefaults) {
    const model = form.models[i]
    if (!model) return

    const variants = parseDefaults(defaults)
    flag(i, "image", defaults.image, model.image)
    flag(i, "reasoning", defaults.reasoning, model.reasoning)
    if (variants.length > 0 && !model.reasoning) setForm("models", i, "reasoning", true)
    field(i, "contextLimit", defaults.contextLimit, model.contextLimit)
    field(i, "outputLimit", defaults.outputLimit, model.outputLimit)

    const prices = [defaults.inputCost, defaults.outputCost, defaults.cacheReadCost, defaults.cacheWriteCost]
    const priced = prices.some((value) => value !== undefined)
    if (priced && !model.costEnabled) setForm("models", i, "costEnabled", true)
    field(i, "inputCost", defaults.inputCost, model.inputCost)
    field(i, "outputCost", defaults.outputCost, model.outputCost)
    field(i, "cacheReadCost", defaults.cacheReadCost, model.cacheReadCost)
    field(i, "cacheWriteCost", defaults.cacheWriteCost, model.cacheWriteCost)
    if (variants.length > 0 && model.variants.length === 0) {
      setForm("models", i, "variants", variants)
      setErrors("models", i, "variants", variants.map(() => ({})))
    }
  }

  function nearby(id: string) {
    const pids = [form.providerID.trim(), props.existing?.providerID].filter(Boolean) as string[]
    return defaultCandidates(provider.providers(), form.npm, id, 5, {
      excludeProviders: pids,
    })
  }

  function suggest(i: number, id: string) {
    if (!id.trim()) {
      setSuggestion((value) => (value?.index === i ? undefined : value))
      return
    }
    const items = nearby(id)
    setSuggestion(items.length > 0 ? { index: i, id, items } : undefined)
  }

  function fill(i: number, id: string) {
    setForm("models", i, "id", id)
    const direct = defaultsForModel(provider.providers(), form.npm, id)
    if (hasDefaults(direct)) {
      apply(i, direct)
      setSuggestion(undefined)
      return
    }
    suggest(i, id)
  }

  function choose(i: number, defaults: CustomProviderDefaults) {
    apply(i, defaults)
    setSuggestion(undefined)
    setPreview(undefined)
  }

  function defaults(id: string) {
    return defaultsForModel(provider.providers(), form.npm, id)
  }

  function variantNames(model: ModelEntry) {
    const current = model.variants.map((item) => item.name.trim()).filter(Boolean)
    if (current.length > 0) return current
    if (!editing() || !model.reasoning || !model.id.trim()) return undefined
    const variants = parseDefaults(defaults(model.id)).map((item) => item.name.trim()).filter(Boolean)
    return variants.length > 0 ? variants : undefined
  }

  function selectVariant(i: number, name: string) {
    const model = form.models[i]
    if (!model) return

    const source = model.variants.length > 0 ? model.variants : parseDefaults(defaults(model.id))
    if (!source.some((item) => item.name.trim() === name.trim())) return

    const variants = prioritizeVariants(source, name)
    if (variants.length === 0) return
    if (!model.reasoning) setForm("models", i, "reasoning", true)
    setForm("models", i, "variants", variants)
    setErrors("models", i, "variants", variants.map(() => ({})))
  }

  function addVariant(i: number) {
    setForm("models", i, "variants", (items) => [...items, blankVariant()])
    setErrors("models", i, "variants", (items) => [...(items ?? []), {}])
  }

  function removeVariant(i: number, vi: number) {
    setForm("models", i, "variants", (items) => items.filter((_, index) => index !== vi))
    setErrors("models", i, "variants", (items) => (items ?? []).filter((_, index) => index !== vi))
  }

  function setVariant<K extends keyof VariantEntry>(i: number, vi: number, key: K, value: VariantEntry[K]) {
    setForm("models", i, "variants", vi, key, value)
  }

  function value(item: number | undefined) {
    return item === undefined ? language.t("provider.custom.models.defaults.empty") : String(item)
  }

  function format(item: string) {
    return item.charAt(0).toUpperCase() + item.slice(1)
  }

  function variantSummary(defaults: CustomProviderDefaults) {
    const items = Object.keys(defaults.variants ?? {})
    return items.length > 0
      ? items.map(format).join(", ")
      : language.t("provider.custom.models.defaults.empty")
  }

  function enabled(item: boolean | undefined) {
    if (item === undefined) return language.t("provider.custom.models.defaults.empty")
    return item
      ? language.t("provider.custom.models.defaults.yes")
      : language.t("provider.custom.models.defaults.no")
  }

  function costSummary(defaults: CustomProviderDefaults) {
    const items = [
      defaults.inputCost !== undefined
        ? `${language.t("provider.custom.models.inputCost.label")}: ${defaults.inputCost}`
        : undefined,
      defaults.outputCost !== undefined
        ? `${language.t("provider.custom.models.outputCost.label")}: ${defaults.outputCost}`
        : undefined,
      defaults.cacheReadCost !== undefined
        ? `${language.t("provider.custom.models.cacheReadCost.label")}: ${defaults.cacheReadCost}`
        : undefined,
      defaults.cacheWriteCost !== undefined
        ? `${language.t("provider.custom.models.cacheWriteCost.label")}: ${defaults.cacheWriteCost}`
        : undefined,
    ].filter((item): item is string => item !== undefined)
    return items.length > 0 ? items.join("\n") : language.t("provider.custom.models.defaults.empty")
  }

  function showPreview(e: Event, item: DefaultCandidate) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const width = 280
    const gap = 8
    const right = rect.right + gap
    const left = right + width < window.innerWidth - gap ? right : Math.max(gap, rect.left - width - gap)
    const top = Math.max(gap, Math.min(rect.top, window.innerHeight - 230))
    setPreview({ item, left, top })
  }

  // ── 模型选择器操作 ──────────────────────────────────────────────────

  function toggleModel(id: string) {
    const next = new Set(selected())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function selectAll() {
    const next = new Set(selected())
    for (const m of filtered()) next.add(m.id)
    setSelected(next)
  }

  function deselectAll() {
    const next = new Set(selected())
    for (const m of filtered()) next.delete(m.id)
    setSelected(next)
  }

  function count() {
    return selected().size
  }

  function addSelected() {
    const models = fetchedModels()
    if (!models) return
    const sel = selected()
    const picked = models.filter((m) => sel.has(m.id))
    if (picked.length === 0) return

    // 替换唯一空行,否则追加到现有列表末尾。
    const row = form.models[0]
    const empty = form.models.length === 1 && !!row && !row.id.trim() && !row.name.trim()

    // Dedup against models already in the form (trimmed, case-insensitive). The
    // picker is built from a fetch-time snapshot, so a model the user typed
    // manually after fetching hasn't been filtered out yet.
    const existing = new Set(form.models.map((m) => m.id.trim().toLowerCase()).filter(Boolean))
    const toAdd = picked.filter((m) => {
      const key = m.id.trim().toLowerCase()
      if (!key || existing.has(key)) {
        return false
      }
      existing.add(key)
      return true
    })

    const entry = (m: FetchedModel): ModelEntry =>
      mergeModelDefaults(
        {
          id: m.id,
          name: m.name,
          image: m.image ?? false,
          outputModalities: ["text"],
          contextLimit: text(m.contextLimit),
          outputLimit: text(m.outputLimit),
          costEnabled:
            m.inputCost !== undefined ||
            m.outputCost !== undefined ||
            m.cacheReadCost !== undefined ||
            m.cacheWriteCost !== undefined,
          inputCost: text(m.inputCost),
          outputCost: text(m.outputCost),
          cacheReadCost: text(m.cacheReadCost),
          cacheWriteCost: text(m.cacheWriteCost),
          reasoning: m.reasoning ?? false,
          variants: [],
        },
        defaultsForModel(provider.providers(), form.npm, m.id),
      )
    const start = empty ? 0 : form.models.length
    const merged = empty ? toAdd.map(entry) : [...form.models, ...toAdd.map(entry)]

    if (toAdd.length > 0) {
      setForm("models", merged)
      setErrors(
        "models",
        merged.map((m) => ({ variants: m.variants.map(() => ({})) })),
      )
      setFetchStatus(language.t("provider.custom.models.fetch.added", { count: String(toAdd.length) }))
      const target = toAdd
        .map((m, offset) => ({ id: m.id, index: start + offset }))
        .find((m) => nearby(m.id).length > 0)
      if (target) suggest(target.index, target.id)
    }

    // Keep the picker open with the un-picked models so the user can keep adding.
    // Remove every selected model, including ones skipped as duplicates, so the
    // user isn't re-prompted to add them. Only close when nothing is left.
    const pickedIds = new Set(picked.map((m) => m.id))
    const remaining = models.filter((m) => !pickedIds.has(m.id))

    if (toAdd.length > 0) {
      // Count only models actually added, not duplicates that were skipped.
      setFetchStatus(language.t("provider.custom.models.fetch.added", { count: String(toAdd.length) }))
    } else if (remaining.length === 0) {
      // Nothing added and nothing left in the picker; every fetched model exists.
      setFetchStatus(language.t("provider.custom.models.fetch.allExist"))
    } else {
      // The selected models already existed but other fetched models remain;
      // avoid implying everything was added. Dropping them from the picker is
      // the feedback. Clear any stale status from a prior add.
      setFetchStatus(undefined)
    }

    if (remaining.length === 0) {
      setFetchedModels(undefined)
      setSearch("")
    } else {
      setFetchedModels(remaining)
      setSelected(new Set<string>())
    }
  }

  function cancelFetch() {
    setFetchedModels(undefined)
    setSearch("")
  }

  // ── 表单辅助函数 ────────────────────────────────────────────────────

  function goBack() {
    if (props.onBack) {
      props.onBack()
      return
    }
    dialog.close()
  }

  function addModel() {
    setForm("models", (v) => [...v, blankModel()])
    setErrors("models", (v) => [...v, { variants: [] }])
  }

  function removeModel(index: number) {
    setSuggestion(undefined)
    setPreview(undefined)
    if (form.models.length <= 1) {
      setForm("models", [blankModel()])
      setErrors("models", [{ variants: [] }])
      refreshModels()
      return
    }
    setForm("models", (v) => v.filter((_, i) => i !== index))
    setErrors("models", (v) => v.filter((_, i) => i !== index))
    refreshModels()
  }

  function refreshModels() {
    queueMicrotask(() => {
      if (!/^https?:\/\//.test(fetchURL().trim())) return
      doFetch()
    })
  }

  function canRemoveModel(model: ModelEntry) {
    return (
      form.models.length > 1 ||
      model.id.trim().length > 0 ||
      model.name.trim().length > 0 ||
      model.contextLimit.trim().length > 0 ||
      model.outputLimit.trim().length > 0 ||
      model.inputCost.trim().length > 0 ||
      model.outputCost.trim().length > 0 ||
      model.cacheReadCost.trim().length > 0 ||
      model.cacheWriteCost.trim().length > 0 ||
      model.image ||
      model.reasoning ||
      model.variants.length > 0
    )
  }

  function addHeader() {
    setForm("headers", (v) => [...v, { key: "", value: "" }])
    setErrors("headers", (v) => [...v, {}])
  }

  function removeHeader(index: number) {
    if (form.headers.length <= 1) return
    setForm("headers", (v) => v.filter((_, i) => i !== index))
    setErrors("headers", (v) => v.filter((_, i) => i !== index))
  }

  function validate() {
    const output = validateCustomProvider({
      form,
      t: language.t,
      editing: editing(),
      disabledProviders: config().disabled_providers ?? [],
      existingProviderIDs: new Set(Object.keys(provider.providers())),
      existingEnv: props.existing?.config?.env,
    })
    setErrors(reconcile(output.errors))
    return output.result
  }

  function save(e: SubmitEvent) {
    e.preventDefault()
    if (form.saving) return

    const result = validate()
    if (!result) return

    setForm("saving", true)

    action.send(
      {
        type: "saveCustomProvider",
        providerID: result.providerID,
        config: result.config,
        apiKey: apiTouched() ? result.key : undefined,
        apiKeyChanged: apiTouched(),
      },
      {
        onConnected: () => {
          setForm("saving", false)
          dialog.close()
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
            description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
          })
        },
        onError: (message) => {
          setForm("saving", false)
          showToast({ title: language.t("common.requestFailed"), description: message.message })
        },
      },
    )
  }

  // ── 渲染 ────────────────────────────────────────────────────────────

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "24px",
          padding: "0 10px 12px 10px",
          "overflow-y": "auto",
          "max-height": "60vh",
        }}
      >
        <div style={{ padding: "0 10px", display: "flex", gap: "16px", "align-items": "center" }}>
          <ProviderIcon id="synthetic" width={20} height={20} />
          <div
            style={{ "font-size": "var(--kilo-font-size-16)", "font-weight": "500", color: "var(--vscode-foreground)" }}
          >
            {editing() ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")}
          </div>
        </div>

        <form
          onSubmit={save}
          style={{ padding: "0 10px 24px 10px", display: "flex", "flex-direction": "column", gap: "24px" }}
        >
          <div style={{ "font-size": "var(--kilo-font-size-14)", color: "var(--text-base)" }}>
            {language.t("provider.custom.description.prefix")}
            <a
              href="https://kilo.ai/docs/ai-providers#custom-provider"
              onClick={(e) => {
                e.preventDefault()
                vscode.postMessage({
                  type: "openExternal",
                  url: "https://kilo.ai/docs/ai-providers#custom-provider",
                })
              }}
            >
              {language.t("provider.custom.description.link")}
            </a>
            {language.t("provider.custom.description.suffix")}
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
            <div
              style={{
                display: "grid",
                "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
              }}
            >
              <TextField
                autofocus={!editing()}
                label={language.t("provider.custom.field.providerID.label")}
                placeholder={language.t("provider.custom.field.providerID.description")}
                title={language.t("provider.custom.field.providerID.description")}
                value={form.providerID}
                onChange={(v) => setForm("providerID", v)}
                validationState={errors.providerID ? "invalid" : undefined}
                error={errors.providerID}
                disabled={editing()}
              />
              <TextField
                label={language.t("provider.custom.field.name.label")}
                placeholder={language.t("provider.custom.field.name.placeholder")}
                value={form.name}
                onChange={(v) => setForm("name", v)}
                validationState={errors.name ? "invalid" : undefined}
                error={errors.name}
              />
            </div>
            <div
              class="custom-provider-dialog-api-row"
              style={{
                display: "grid",
                "grid-template-columns": "minmax(150px, 0.8fr) minmax(0, 1.2fr)",
                gap: "12px",
                "align-items": "start",
              }}
            >
              <div
                class="custom-provider-dialog-field"
                style={{ display: "flex", "flex-direction": "column", gap: "4px", "min-width": "0" }}
              >
                <label
                  style={{
                    "font-size": "var(--kilo-font-size-12)",
                    "font-weight": "500",
                    color: "var(--text-weak-base)",
                  }}
                >
                  {language.t("provider.custom.field.package.label")}
                </label>
                <Select
                  options={PACKAGE_OPTIONS}
                  current={PACKAGE_OPTIONS.find((option) => option.value === form.npm)}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  onSelect={(option) => {
                    if (!option) return
                    setForm("npm", option.value)
                    setFetchPackage(option.value)
                  }}
                  variant="secondary"
                  triggerVariant="settings"
                  triggerStyle={{ width: "100%" }}
                />
              </div>
              <div class="custom-provider-dialog-field" style={{ "min-width": "0" }}>
                <TextField
                  label={language.t("provider.custom.field.baseURL.label")}
                  placeholder={language.t("provider.custom.field.baseURL.placeholder")}
                  value={form.baseURL}
                  onChange={(v) => {
                    setForm("baseURL", v)
                    setFetchURL(v)
                  }}
                  validationState={errors.baseURL ? "invalid" : undefined}
                  error={errors.baseURL}
                />
              </div>
            </div>
            <TextField
              type="password"
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={
                editing() && auth === "api" && !apiTouched()
                  ? language.t("provider.custom.field.apiKey.placeholder.saved")
                  : language.t("provider.custom.field.apiKey.placeholder")
              }
              value={form.apiKey}
              onChange={(v) => {
                setApiTouched(true)
                setForm("apiKey", v)
                setFetchKey(v)
              }}
            />
          </div>

          {/* 模型 */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <label
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  "font-weight": "500",
                  color: "var(--text-weak-base)",
                }}
              >
                {language.t("provider.custom.models.label")}
              </label>
              <Show when={fetching()}>
                <Spinner style={{ width: "12px", height: "12px" }} />
              </Show>
            </div>
            <For each={form.models}>
              {(m, i) => (
                <>
                  <ModelCard
                    m={m}
                    i={i}
                    errors={errors.models[i()] ?? {}}
                    t={language.t}
                    canRemove={canRemoveModel(m)}
                    variantNames={variantNames(m)}
                    onChangeId={(v) => fill(i(), v)}
                    onChangeName={(v) => setForm("models", i(), "name", v)}
                    onChangeImage={(v) => setForm("models", i(), "image", v)}
                    onChangeContextLimit={(v) => setForm("models", i(), "contextLimit", v)}
                    onChangeOutputLimit={(v) => setForm("models", i(), "outputLimit", v)}
                    onChangeCostEnabled={(v) => setForm("models", i(), "costEnabled", v)}
                    onChangeInputCost={(v) => setForm("models", i(), "inputCost", v)}
                    onChangeOutputCost={(v) => setForm("models", i(), "outputCost", v)}
                    onChangeCacheReadCost={(v) => setForm("models", i(), "cacheReadCost", v)}
                    onChangeCacheWriteCost={(v) => setForm("models", i(), "cacheWriteCost", v)}
                    onChangeReasoning={(v) => setForm("models", i(), "reasoning", v)}
                    onSelectVariant={(v) => selectVariant(i(), v)}
                    onAddVariant={() => addVariant(i())}
                    onRemoveVariant={(vi) => removeVariant(i(), vi)}
                    onChangeVariantName={(vi, v) => setVariant(i(), vi, "name", v)}
                    onChangeEnableThinking={(vi, v) => setVariant(i(), vi, "enableThinking", v)}
                    onChangeThinking={(vi, v) => setVariant(i(), vi, "thinking", v)}
                    onChangeSplitReasoning={(vi, v) => setVariant(i(), vi, "splitReasoning", v)}
                    onChangeReasoningEffort={(vi, v) => setVariant(i(), vi, "reasoningEffort", v)}
                    onChangeOutputEffort={(vi, v) => setVariant(i(), vi, "outputEffort", v)}
                    onChangeChatTemplateArgs={(vi, v: ChatTemplateArgsValue) => setVariant(i(), vi, "chatTemplateArgs", v)}
                    onRemove={() => removeModel(i())}
                  />
                  <Show when={suggestion()?.index === i() ? suggestion() : undefined}>
                    {(data) => (
                      <div
                        style={{
                          border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
                          "border-radius": "6px",
                          padding: "10px",
                          display: "flex",
                          "flex-direction": "column",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            "justify-content": "space-between",
                            "align-items": "center",
                            gap: "8px",
                          }}
                        >
                          <div style={{ display: "flex", "flex-direction": "column", gap: "2px" }}>
                            <span
                              style={{
                                "font-size": "var(--kilo-font-size-12)",
                                "font-weight": "500",
                                color: "var(--text-weak-base)",
                              }}
                            >
                              {language.t("provider.custom.models.defaults.title")}
                            </span>
                          </div>
                          <Button
                            type="button"
                            size="small"
                            variant="ghost"
                            onClick={() => {
                              setSuggestion(undefined)
                              setPreview(undefined)
                            }}
                          >
                            {language.t("common.dismiss")}
                          </Button>
                        </div>

                        <div style={{ display: "flex", "flex-direction": "column", gap: "3px" }}>
                          <For each={data().items}>
                            {(item) => (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => choose(i(), item.defaults)}
                                onMouseEnter={(e: MouseEvent) => showPreview(e, item)}
                                onFocus={(e: FocusEvent) => showPreview(e, item)}
                                onMouseLeave={() => setPreview(undefined)}
                                onBlur={() => setPreview(undefined)}
                                style={{
                                  border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
                                  "border-radius": "6px",
                                  padding: "3px 8px",
                                  background: "var(--vscode-input-background)",
                                  color: "var(--text-base, var(--vscode-foreground))",
                                  cursor: "pointer",
                                  display: "flex",
                                  "flex-direction": "column",
                                  gap: "0",
                                  height: "auto",
                                  "min-height": "38px",
                                  "align-items": "center",
                                  "justify-content": "center",
                                  "text-align": "center",
                                  "white-space": "normal",
                                }}
                              >
                                <span
                                  style={{
                                    "font-size": "var(--kilo-font-size-13)",
                                    "font-weight": "500",
                                    "line-height": "15px",
                                  }}
                                >
                                  {item.name}
                                </span>
                                <span
                                  style={{
                                    "font-size": "var(--kilo-font-size-12)",
                                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                                    "line-height": "15px",
                                  }}
                                >
                                  {item.providerID}/{item.modelID}
                                </span>
                              </Button>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </Show>
                </>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel}>
              {language.t("provider.custom.models.add")}
            </Button>

            {/* 发现错误 */}
            <Show when={fetchError()}>
              {(err) => (
                <span
                  style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground, #f14c4c)" }}
                >
                  {err()}
                </span>
              )}
            </Show>

            {/* 发现状态 */}
            <Show when={!fetchError() && fetchStatus()}>
              {(status) => (
                <span
                  style={{
                    "font-size": "var(--kilo-font-size-12)",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                  }}
                >
                  {status()}
                </span>
              )}
            </Show>

            {/* 模型选择器 */}
            <Show when={fetchedModels()}>
              {(models) => (
                <div
                  style={{
                    border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
                    "border-radius": "6px",
                    padding: "12px",
                    display: "flex",
                    "flex-direction": "column",
                    gap: "8px",
                  }}
                >
                  {/* 标题、数量和展开切换 */}
                  <div
                    style={{
                      display: "flex",
                      "justify-content": "space-between",
                      "align-items": "center",
                    }}
                  >
                    <span
                      style={{
                        "font-size": "var(--kilo-font-size-12)",
                        "font-weight": "500",
                        color: "var(--text-weak-base)",
                      }}
                    >
                      <Show
                        when={debouncedSearch()}
                        fallback={language.t("provider.custom.models.fetch.found", {
                          count: String(models().length),
                        })}
                      >
                        {language.t("provider.custom.models.fetch.showing", {
                          shown: String(filtered().length),
                          total: String(models().length),
                        })}
                      </Show>
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <Button type="button" size="small" variant="ghost" onClick={selectAll}>
                        {language.t("provider.custom.models.fetch.selectAll")}
                      </Button>
                      <Button type="button" size="small" variant="ghost" onClick={deselectAll}>
                        {language.t("provider.custom.models.fetch.deselectAll")}
                      </Button>
                    </div>
                  </div>

                  {/* 搜索 */}
                  <Show when={models().length > 10}>
                    <TextField
                      label={language.t("provider.custom.models.fetch.search")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.fetch.search")}
                      value={search()}
                      onChange={setSearch}
                    />
                  </Show>

                  {/* 模型列表 */}
                  <div
                    style={{
                      "max-height": "200px",
                      "overflow-y": "auto",
                      display: "flex",
                      "flex-direction": "column",
                      gap: "2px",
                    }}
                  >
                    <For each={filtered()}>
                      {(m) => (
                        <label
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "4px 2px",
                            cursor: "pointer",
                            "font-size": "var(--kilo-font-size-13)",
                            color: "var(--text-base, var(--vscode-foreground))",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected().has(m.id)}
                            onChange={() => toggleModel(m.id)}
                            style={{ cursor: "pointer" }}
                          />
                          {m.id}
                        </label>
                      )}
                    </For>
                  </div>

                  {/* 操作 */}
                  <div style={{ display: "flex", gap: "8px", "margin-top": "4px" }}>
                    <Button type="button" size="small" variant="primary" onClick={addSelected} disabled={count() === 0}>
                      {language.t("provider.custom.models.fetch.add", { count: String(count()) })}
                    </Button>
                    <Button type="button" size="small" variant="ghost" onClick={cancelFetch}>
                      {language.t("common.cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </Show>
          </div>

          {/* 请求头 */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <label
              style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
            >
              {language.t("provider.custom.headers.label")}
            </label>
            <For each={form.headers}>
              {(h, i) => (
                <div style={{ display: "flex", gap: "8px", "align-items": "start" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setForm("headers", i(), "key", v)}
                      validationState={errors.headers[i()]?.key ? "invalid" : undefined}
                      error={errors.headers[i()]?.key}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setForm("headers", i(), "value", v)}
                      validationState={errors.headers[i()]?.value ? "invalid" : undefined}
                      error={errors.headers[i()]?.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                    style={{ "margin-top": "6px" }}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader}>
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>

          <Button type="submit" size="large" variant="primary" disabled={form.saving}>
            {form.saving ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
        <Show when={preview()}>
          {(data) => (
            <div
              style={{
                position: "fixed",
                top: `${data().top}px`,
                left: `${data().left}px`,
                width: "280px",
                "z-index": 1000,
                border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
                "border-radius": "6px",
                padding: "10px",
                background: "var(--vscode-editorWidget-background, var(--vscode-input-background))",
                color: "var(--text-base, var(--vscode-foreground))",
                "box-shadow": "0 8px 24px rgba(0, 0, 0, 0.32)",
                "font-size": "var(--kilo-font-size-12)",
                "line-height": "16px",
              }}
            >
              <div
                style={{
                  "font-weight": "600",
                  "font-size": "var(--kilo-font-size-13)",
                  "line-height": "18px",
                  "margin-bottom": "2px",
                }}
              >
                {data().item.name}
              </div>
              <div
                style={{
                  color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                  "margin-bottom": "8px",
                  "word-break": "break-word",
                }}
              >
                {data().item.providerID}/{data().item.modelID}
              </div>
              <div style={{ display: "grid", "grid-template-columns": "auto 1fr", gap: "5px 10px" }}>
                <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                  {language.t("provider.custom.models.image.label")}
                </span>
                <span>{enabled(data().item.defaults.image)}</span>
                <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                  {language.t("provider.custom.models.reasoning.label")}
                </span>
                <span>{enabled(data().item.defaults.reasoning)}</span>
                <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                  {language.t("provider.custom.models.variants.reasoningEffort.label")}
                </span>
                <span>{variantSummary(data().item.defaults)}</span>
                <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                  {language.t("provider.custom.models.contextLimit.label")}
                </span>
                <span>{value(data().item.defaults.contextLimit)}</span>
                <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                  {language.t("provider.custom.models.outputLimit.label")}
                </span>
                <span>{value(data().item.defaults.outputLimit)}</span>
                <span style={{ color: "var(--text-weak-base, var(--vscode-descriptionForeground))" }}>
                  {language.t("provider.custom.models.cost.label")}
                </span>
                <span style={{ "white-space": "pre-line" }}>{costSummary(data().item.defaults)}</span>
              </div>
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  )
}

export default CustomProviderDialog
