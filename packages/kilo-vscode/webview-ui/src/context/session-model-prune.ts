import { batch, createEffect } from "solid-js"
import type { Accessor, Setter } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"
import { produce } from "solid-js/store"
import type { ModelSelection, Provider, WebviewMessage } from "../types/messages"

export interface PruneStore {
  modelSelections: Record<string, ModelSelection | null>
  sessionOverrides: Record<string, ModelSelection>
  recentModels: ModelSelection[]
  favoriteModels: ModelSelection[]
}

interface Input {
  providers: Accessor<Record<string, Provider>>
  connected: Accessor<string[]>
  store: PruneStore
  setStore: SetStoreFunction<PruneStore>
  setAgents: Setter<Record<string, boolean>>
  post: (message: WebviewMessage) => void
  valid: (selection: ModelSelection | null) => boolean
}

export function createStaleModelPruner(input: Input) {
  createEffect(() => {
    if (Object.keys(input.providers()).length === 0) return
    input.connected()

    const stale = (selection: ModelSelection | null | undefined) => !!selection && !input.valid(selection)
    const sessions = Object.keys(input.store.sessionOverrides).filter((sid) => stale(input.store.sessionOverrides[sid]))
    const agents = Object.keys(input.store.modelSelections).filter((name) => stale(input.store.modelSelections[name]))
    const recents = input.store.recentModels.filter((item) => !stale(item))
    const favorites = input.store.favoriteModels.filter((item) => !stale(item))
    const dropped = input.store.favoriteModels.filter((item) => stale(item))
    const recent = recents.length !== input.store.recentModels.length
    const favorite = favorites.length !== input.store.favoriteModels.length

    if (sessions.length === 0 && agents.length === 0 && !recent && !favorite) return

    batch(() => {
      if (sessions.length > 0) {
        input.setStore(
          "sessionOverrides",
          produce((overrides) => {
            for (const sid of sessions) delete overrides[sid]
          }),
        )
      }
      if (agents.length > 0) {
        input.setAgents((prev) => {
          const next = { ...prev }
          for (const name of agents) delete next[name]
          return next
        })
        input.setStore(
          "modelSelections",
          produce((selections) => {
            for (const name of agents) delete selections[name]
          }),
        )
      }
      if (recent) input.setStore("recentModels", recents)
      if (favorite) input.setStore("favoriteModels", favorites)
    })

    for (const name of agents) input.post({ type: "clearModelSelection", agent: name })
    if (recent) input.post({ type: "persistRecents", recents })
    for (const item of dropped) {
      input.post({ type: "toggleFavorite", action: "remove", providerID: item.providerID, modelID: item.modelID })
    }
  })
}
