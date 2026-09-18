import type { Accessor } from "solid-js"
import type { AgentConfig, ExtensionMessage, ModelSelection } from "../types/messages"
import {
  DEFAULT_VARIANT,
  getAgentVariant,
  getVariant,
  legacyVariantKey,
  preserveVariant,
  storedVariant,
  variantKey,
} from "./session-variant-store"

interface Model {
  variants?: Record<string, unknown>
  // kilocode_change - ZLF：编译层打标的「默认推理强度」（配置手写 variants 的第一个键）
  defaultVariant?: string
}

type Message = { type: "requestVariants" } | { type: "persistVariant"; key: string; value: string }

interface Options {
  selections: Accessor<Record<string, string>>
  set: (key: string, value: string) => void
  selected: (sessionID?: string) => ModelSelection | null
  session: Accessor<string | undefined>
  agent: (sessionID?: string) => string
  config: (agent: string) => Pick<AgentConfig, "model" | "variant"> | undefined
  find: (selection: ModelSelection) => Model | undefined
  post: (message: Message) => void
  listen: (handler: (message: ExtensionMessage) => void) => () => void
  preferred?: Accessor<(ModelSelection & { variant?: string }) | undefined>
  remember: (agent: string, model: ModelSelection, variant: string) => void
}

export function createSessionVariants(options: Options) {
  const list = (sessionID?: string) => {
    const selection = options.selected(sessionID)
    if (!selection) return []
    return Object.keys(options.find(selection)?.variants ?? {})
  }

  const configured = (name: string, selection: ModelSelection) => {
    const config = options.config(name)
    if (config?.model !== `${selection.providerID}/${selection.modelID}`) return undefined
    return config.variant ?? undefined
  }

  const preferred = (selection: ModelSelection) => {
    const value = options.preferred?.()
    if (value?.providerID !== selection.providerID || value.modelID !== selection.modelID) return undefined
    return value.variant ?? DEFAULT_VARIANT
  }

  const agent = (name: string, selection: ModelSelection | null) => {
    if (!selection) return undefined
    return getAgentVariant(
      options.selections(),
      selection,
      options.find(selection),
      name,
      configured(name, selection),
      preferred(selection),
    )
  }

  const current = (sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return undefined
    const variants = list(sid)
    if (variants.length === 0) return undefined
    const name = options.agent(sid)
    const value = getVariant(
      options.selections(),
      selection,
      variants,
      name,
      sid,
      configured(name, selection),
      preferred(selection),
    )
    if (value !== undefined) return value
    // kilocode_change start - ZLF：链尾回退模型的「默认推理强度」（自定义 provider 编辑
    // 对话框置顶的档）。上游的 agent 配置级默认（configured，v7.5.6）与显式新会话选择
    // 记忆（preferred，v7.7.5）均已在 getVariant 内优先生效；显式选过「默认」（存
    // DEFAULT_VARIANT）保持裸发，不落到本回退。
    const stored = storedVariant(options.selections(), selection, name, sid)
    if (stored === DEFAULT_VARIANT) return undefined
    const fallback = options.find(selection)?.defaultVariant
    return fallback && variants.includes(fallback) ? fallback : undefined
    // kilocode_change end
  }

  const request = (sessionID?: string) =>
    current(sessionID) ?? (list(sessionID).length > 0 ? DEFAULT_VARIANT : undefined)

  const saved = (selection: ModelSelection, name: string, sessionID?: string) =>
    (sessionID ? options.selections()[variantKey(selection, name, sessionID)] : undefined) ??
    preferred(selection) ??
    options.selections()[variantKey(selection, name)] ??
    options.selections()[legacyVariantKey(selection)] ??
    configured(name, selection)

  const choice = (sessionID?: string) => {
    const id = sessionID ?? options.session()
    const model = options.selected(id)
    return model ? saved(model, options.agent(id), id) : undefined
  }

  const select = (value: string | undefined, sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return
    const key = variantKey(selection, options.agent(sid), sid)
    const next = value ?? DEFAULT_VARIANT
    options.set(key, next)
    if (!sid || /^(?:sidebar-)?pending:/.test(sid)) {
      options.remember(options.agent(sid), selection, next)
    }
  }

  const carry = (selection: ModelSelection, value: string | undefined, name: string, sessionID?: string) => {
    const list = Object.keys(options.find(selection)?.variants ?? {})
    if (list.length === 0) return
    // Undefined leaves the target's effort intact; an explicit Default must be carried.
    const next = value === DEFAULT_VARIANT ? DEFAULT_VARIANT : preserveVariant(value, list)
    if (next === undefined) return
    const key = variantKey(selection, name, sessionID)
    options.set(key, next)
    if (!sessionID) options.post({ type: "persistVariant", key, value: next })
  }

  const load = () => {
    const unsub = options.listen((message) => {
      if (message.type !== "variantsLoaded") return
      for (const [key, value] of Object.entries(message.variants)) {
        if (key.startsWith("session/")) continue
        options.set(key, value)
      }
    })
    options.post({ type: "requestVariants" })
    return unsub
  }

  return { carry, list, agent, current, request, saved, choice, select, load }
}
