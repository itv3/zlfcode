import type { Accessor } from "solid-js"
import type { ExtensionMessage, ModelSelection } from "../types/messages"
import {
  DEFAULT_VARIANT,
  getAgentVariant,
  getVariant,
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
  find: (selection: ModelSelection) => Model | undefined
  post: (message: Message) => void
  listen: (handler: (message: ExtensionMessage) => void) => () => void
}

export function createSessionVariants(options: Options) {
  const list = (sessionID?: string) => {
    const selection = options.selected(sessionID)
    if (!selection) return []
    return Object.keys(options.find(selection)?.variants ?? {})
  }

  const agent = (name: string, selection: ModelSelection | null) => {
    if (!selection) return undefined
    return getAgentVariant(options.selections(), selection, options.find(selection), name)
  }

  const current = (sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return undefined
    const variants = list(sid)
    if (variants.length === 0) return undefined
    const value = getVariant(options.selections(), selection, variants, options.agent(sid), sid)
    if (value !== undefined) return value
    // kilocode_change start - ZLF：从未选择过变体时采用模型的「默认推理强度」
    // （编辑对话框置顶的档）；显式选过「默认」（存 DEFAULT_VARIANT）保持裸发。
    const stored = storedVariant(options.selections(), selection, options.agent(sid), sid)
    if (stored === DEFAULT_VARIANT) return undefined
    const fallback = options.find(selection)?.defaultVariant
    return fallback && variants.includes(fallback) ? fallback : undefined
    // kilocode_change end
  }

  const select = (value: string | undefined, sessionID?: string) => {
    const sid = sessionID ?? options.session()
    const selection = options.selected(sid)
    if (!selection) return
    const key = variantKey(selection, options.agent(sid), sid)
    const next = value ?? DEFAULT_VARIANT
    options.set(key, next)
    if (!sid) options.post({ type: "persistVariant", key, value: next })
  }

  const carry = (selection: ModelSelection, value: string | undefined, name: string, sessionID?: string) => {
    const list = Object.keys(options.find(selection)?.variants ?? {})
    if (list.length === 0) return
    // kilocode_change start - ZLF：三态传播。undefined（从未选择）不写入，让新模型
    // 走自己的「默认推理强度」；DEFAULT_VARIANT（显式默认）沿上游语义继续传播；
    // 具体档名按最近档映射传播。上游原实现把「从未选择」也写成显式默认，会把
    // 新模型的置顶默认档永久锁死为裸发。
    const next =
      value === undefined ? undefined : value === DEFAULT_VARIANT ? DEFAULT_VARIANT : preserveVariant(value, list)
    // kilocode_change end
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

  return { carry, list, agent, current, select, load }
}
