/**
 * Provider/model context
 * Manages available providers, models, and the global default selection.
 * Selection is now per-session — see session.tsx.
 */

import { createContext, useContext, createSignal, createMemo, onCleanup } from "solid-js"
import type { ParentComponent, Accessor } from "solid-js"
import { useVSCode } from "./vscode"
import type { Provider, ProviderModel, ModelSelection, ExtensionMessage, ProviderAuthState } from "../types/messages"
import type { ProviderAuthMethod } from "@kilocode/sdk/v2/client"
import { flattenModels, findModel as _findModel, isModelValid as isValid, visibleModels as filterModels } from "./provider-utils"
import { KILO_AUTO } from "../../../src/shared/provider-model"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

interface ProviderContextValue {
  providers: Accessor<Record<string, Provider>>
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

  const [providers, setProviders] = createSignal<Record<string, Provider>>({})
  const [connected, setConnected] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<Record<string, string>>({})
  const [defaultSelection, setDefaultSelection] = createSignal<ModelSelection>(KILO_AUTO)
  const [authMethods, setAuthMethods] = createSignal<Record<string, ProviderAuthMethod[]>>({})
  const [authStates, setAuthStates] = createSignal<Record<string, ProviderAuthState>>({})
  const [optimistic, setOptimistic] = createSignal<Record<string, Provider>>({})
  const [optimisticAuth, setOptimisticAuth] = createSignal<Record<string, ProviderAuthState>>({})

  const models = createMemo<EnrichedModel[]>(() => flattenModels(providers()))
  const visibleModels = createMemo<EnrichedModel[]>(() => filterModels(models(), connected()))

  function findModel(selection: ModelSelection | null): EnrichedModel | undefined {
    return _findModel(visibleModels(), selection)
  }

  function isModelValid(selection: ModelSelection | null): boolean {
    return isValid(providers(), connected(), selection)
  }

  // Register handler immediately (not in onMount) so we never miss
  // a providersLoaded message that arrives before the DOM mount.
  const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type === "providerConnected") {
      if (message.provider) {
        setOptimistic((value) => ({ ...value, [message.providerID]: message.provider! }))
        setProviders((value) => ({ ...value, [message.providerID]: message.provider! }))
      }
      setConnected((value) => (value.includes(message.providerID) ? value : [...value, message.providerID]))
      if (message.authState) {
        setOptimisticAuth((value) => ({ ...value, [message.providerID]: message.authState! }))
        setAuthStates((value) => ({ ...value, [message.providerID]: message.authState! }))
      }
      return
    }

    if (message.type === "providerDisconnected") {
      const saved = optimistic()[message.providerID]
      if (saved) {
        setOptimistic((value) => {
          const next = { ...value }
          delete next[message.providerID]
          return next
        })
        setProviders((value) => {
          const next = { ...value }
          delete next[message.providerID]
          return next
        })
      }
      setOptimisticAuth((value) => {
        const next = { ...value }
        delete next[message.providerID]
        return next
      })
      setAuthStates((value) => {
        const next = { ...value }
        delete next[message.providerID]
        return next
      })
      setConnected((value) => value.filter((id) => id !== message.providerID))
      return
    }

    if (message.type !== "providersLoaded") return

    const saved = optimistic()
    const providers = { ...message.providers, ...saved }
    const connected = [...new Set([...message.connected, ...Object.keys(saved)])]
    setProviders(providers)
    setConnected(connected)
    setDefaults(message.defaults)
    setDefaultSelection(message.defaultSelection)
    setAuthMethods(message.authMethods)
    setAuthStates({ ...message.authStates, ...optimisticAuth() })
  })

  onCleanup(unsubscribe)

  // Request providers immediately; if the extension's httpClient is not yet ready,
  // extensionDataReady will fire once initialization completes and we retry once.
  vscode.postMessage({ type: "requestProviders" })

  const fallback = setTimeout(() => {
    if (Object.keys(providers()).length === 0) {
      vscode.postMessage({ type: "requestProviders" })
    }
  }, 3000)

  const unsubReady = vscode.onMessage((message: ExtensionMessage) => {
    if (message.type !== "extensionDataReady") return
    unsubReady()
    clearTimeout(fallback)
    if (Object.keys(providers()).length === 0) {
      vscode.postMessage({ type: "requestProviders" })
    }
  })

  onCleanup(() => {
    unsubReady()
    clearTimeout(fallback)
  })

  const value: ProviderContextValue = {
    providers,
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
