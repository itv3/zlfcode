/** Provider/模型上下文：管理可用模型、连接状态和全局默认选择。 */

import { createContext, useContext, createSignal, createMemo, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type {
  Provider,
  ProviderModel,
  ModelSelection,
  ExtensionMessage,
  ProviderAuthChange,
  ProviderAuthState,
} from "../types/messages"
import type { ProviderAuthMethod } from "@kilocode/sdk/v2/client"
import {
  flattenModels,
  findModel as _findModel,
  isModelValid as isValid,
  visibleModels as filterModels,
} from "./provider-utils"
import { KILO_AUTO } from "../../../src/shared/provider-model"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }
type Loaded = Extract<ExtensionMessage, { type: "providersLoaded" }>
type Change = Extract<
  ExtensionMessage,
  { type: "providersLoaded" | "providerConnected" | "providerDisconnected" }
>
type ProviderMode = Loaded["mode"]
type Timer = ReturnType<typeof setTimeout>
type Schedule = (run: () => void, delay: number) => Timer

const PROVIDER_RETRY_DELAYS = [3_000, 10_000, 30_000] as const

/** 在 connected 权威快照到达前，以单个定时器持续请求，避免启动失败后永久空白。 */
export function createProviderRetry(
  post: () => void,
  schedule: Schedule = (run, delay) => setTimeout(run, delay),
  cancel: (timer: Timer) => void = (timer) => clearTimeout(timer),
) {
  let timer: Timer | undefined
  let attempt = 0
  let done = false

  const arm = () => {
    if (done || timer !== undefined) return
    const delay = PROVIDER_RETRY_DELAYS[Math.min(attempt, PROVIDER_RETRY_DELAYS.length - 1)]
    timer = schedule(() => {
      timer = undefined
      attempt += 1
      post()
      arm()
    }, delay)
  }
  const refresh = () => {
    if (done) return
    if (timer !== undefined) cancel(timer)
    timer = undefined
    post()
    arm()
  }
  const loaded = (mode: ProviderMode) => {
    if (mode !== "connected" || done) return
    done = true
    if (timer !== undefined) cancel(timer)
    timer = undefined
  }
  const dispose = () => {
    done = true
    if (timer !== undefined) cancel(timer)
    timer = undefined
  }

  return { refresh, loaded, dispose }
}

export interface ProviderState {
  revision: number
  providers: Record<string, Provider>
  connected: string[]
  defaults: Record<string, string>
  defaultSelection: ModelSelection
  authMethods: Record<string, ProviderAuthMethod[]>
  authStates: Record<string, ProviderAuthState>
  optimistic: Record<string, Provider>
  optimisticAuth: Record<string, ProviderAuthState>
}

export function initialProviderState(): ProviderState {
  return {
    revision: 0,
    providers: {},
    connected: [],
    defaults: {},
    defaultSelection: KILO_AUTO,
    authMethods: {},
    authStates: {},
    optimistic: {},
    optimisticAuth: {},
  }
}

function without<T>(values: Record<string, T>, id: string) {
  const next = { ...values }
  delete next[id]
  return next
}

function applyAuth(
  states: Record<string, ProviderAuthState>,
  optimistic: Record<string, ProviderAuthState>,
  id: string,
  auth: ProviderAuthChange,
) {
  if (auth.mode === "preserve") return { states, optimistic }
  if (auth.mode === "clear") return { states: without(states, id), optimistic: without(optimistic, id) }
  return {
    states: { ...states, [id]: auth.state },
    optimistic,
  }
}

function applyDefault(defaults: Record<string, string>, id: string, provider: Provider | undefined) {
  if (!provider) return defaults
  const current = defaults[id]
  if (current && provider.models[current]) return defaults
  const next = { ...defaults }
  const model = Object.keys(provider.models)[0]
  if (model) next[id] = model
  if (!model) delete next[id]
  return next
}

/** 按单调 revision 合并 Provider 消息，旧快照不会覆盖较新的精确变更。 */
export function applyProviderMessage(state: ProviderState, message: Change): ProviderState {
  if (message.revision < state.revision) return state
  if (message.type === "providersLoaded") {
    if (message.mode !== "connected") {
      return {
        ...state,
        authMethods: { ...state.authMethods, ...message.authMethods },
        authStates: { ...state.authStates, ...message.authStates },
      }
    }
    return {
      revision: message.revision,
      providers: message.providers,
      connected: [...new Set(message.connected)],
      defaults: message.defaults,
      defaultSelection: message.defaultSelection,
      authMethods: message.authMethods,
      authStates: message.authStates,
      optimistic: {},
      optimisticAuth: {},
    }
  }

  if (message.type === "providerConnected") {
    const auth = applyAuth(state.authStates, state.optimisticAuth, message.providerID, message.auth)
    return {
      ...state,
      revision: message.revision,
      providers: message.provider
        ? { ...state.providers, [message.providerID]: message.provider }
        : state.providers,
      connected: state.connected.includes(message.providerID)
        ? state.connected
        : [...state.connected, message.providerID],
      defaults: applyDefault(state.defaults, message.providerID, message.provider),
      authStates: auth.states,
      optimistic: state.optimistic,
      optimisticAuth: auth.optimistic,
    }
  }

  const defaults = message.removed ? without(state.defaults, message.providerID) : state.defaults
  return {
    ...state,
    revision: message.revision,
    providers: message.removed ? without(state.providers, message.providerID) : state.providers,
    connected: state.connected.filter((id) => id !== message.providerID),
    defaults,
    authStates: without(state.authStates, message.providerID),
    optimistic: without(state.optimistic, message.providerID),
    optimisticAuth: without(state.optimisticAuth, message.providerID),
  }
}

/**
 * 将后端刷新结果作为权威快照,并结束本次保存产生的乐观覆盖。
 * providerConnected 负责在保存完成到刷新返回之间即时更新界面;
 * providersLoaded 到达后必须允许服务端的新增、修改和删除结果生效。
 */
export function reconcile(message: Loaded) {
  return applyProviderMessage(initialProviderState(), message)
}

/** 设置目录可补充未连接项，但 connected 权威项始终覆盖同 ID 的目录数据。 */
export function mergeProviderCatalog(
  providers: Record<string, Provider>,
  catalog: Record<string, Provider>,
): Record<string, Provider> {
  return { ...catalog, ...providers }
}

interface ProviderContextValue {
  providers: Accessor<Record<string, Provider>>
  catalogProviders: Accessor<Record<string, Provider>>
  connected: Accessor<string[]>
  defaults: Accessor<Record<string, string>>
  defaultSelection: Accessor<ModelSelection>
  models: Accessor<EnrichedModel[]>
  visibleModels: Accessor<EnrichedModel[]>
  findModel: (selection: ModelSelection | null) => EnrichedModel | undefined
  authMethods: Accessor<Record<string, ProviderAuthMethod[]>>
  authStates: Accessor<Record<string, ProviderAuthState>>
  isModelValid: (selection: ModelSelection | null) => boolean
}

export const ProviderContext = createContext<ProviderContextValue>()

export const ProviderProvider: ParentComponent = (props) => {
  const vscode = useVSCode()

  let state = initialProviderState()
  const [providers, setProviders] = createSignal(state.providers)
  const [catalog, setCatalog] = createSignal<Record<string, Provider>>({})
  const [connected, setConnected] = createSignal(state.connected)
  const [defaults, setDefaults] = createSignal(state.defaults)
  const [defaultSelection, setDefaultSelection] = createSignal(state.defaultSelection)
  const [authMethods, setAuthMethods] = createSignal(state.authMethods)
  const [authStates, setAuthStates] = createSignal(state.authStates)
  const catalogProviders = createMemo(() => mergeProviderCatalog(providers(), catalog()))
  let catalogRevision = 0

  const models = createMemo<EnrichedModel[]>(() => flattenModels(providers()))
  const visibleModels = createMemo<EnrichedModel[]>(() => filterModels(models(), connected()))

  function findModel(selection: ModelSelection | null): EnrichedModel | undefined {
    return _findModel(visibleModels(), selection)
  }

  function isModelValid(selection: ModelSelection | null): boolean {
    return isValid(providers(), connected(), selection)
  }

  const retry = createProviderRetry(() => vscode.postMessage({ type: "requestProviders", mode: "connected" }))

  // 立即注册处理器，避免 DOM 挂载前到达的 Provider 消息丢失。
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (
      message.type !== "providerConnected" &&
      message.type !== "providerDisconnected" &&
      message.type !== "providersLoaded"
    )
      return
    if (message.type === "providersLoaded" && message.mode === "catalog") {
      if (message.revision < state.revision || message.revision < catalogRevision) return
      catalogRevision = message.revision
      state = applyProviderMessage(state, message)
      setCatalog(message.providers)
      setAuthMethods(state.authMethods)
      setAuthStates(state.authStates)
      retry.loaded(message.mode)
      return
    }
    const next = applyProviderMessage(state, message)
    if (next === state) return
    state = next
    catalogRevision = Math.max(catalogRevision, message.revision)
    if (message.type === "providerConnected" && message.provider) {
      const provider = message.provider
      setCatalog((value) => ({ ...value, [message.providerID]: provider }))
    }
    if (message.type === "providerDisconnected" && message.removed) {
      setCatalog((value) => without(value, message.providerID))
    }
    setProviders(state.providers)
    setConnected(state.connected)
    setDefaults(state.defaults)
    setDefaultSelection(state.defaultSelection)
    setAuthMethods(state.authMethods)
    setAuthStates(state.authStates)
    if (message.type === "providersLoaded") retry.loaded(message.mode)
  })

  onCleanup(unsubscribe)

  retry.refresh()

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    retry.refresh()
  })

  onCleanup(() => {
    unsubReady()
    retry.dispose()
  })

  const value: ProviderContextValue = {
    providers,
    catalogProviders,
    connected,
    defaults,
    defaultSelection,
    models,
    visibleModels,
    findModel,
    authMethods,
    authStates,
    isModelValid,
  }

  return <ProviderContext.Provider value={value}>{props.children}</ProviderContext.Provider>
}

export function useProvider(): ProviderContextValue {
  const context = useContext(ProviderContext)
  if (!context) {
    throw new Error("useProvider must be used within a ProviderProvider")
  }
  return context
}
