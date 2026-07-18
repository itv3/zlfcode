import { Provider } from "@/provider/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { Effect } from "effect"

export type Input = {
  providerID: ProviderV2.ID
  modelIDs: readonly ModelV2.ID[]
}

export type Result = {
  ready: boolean
  missing: ModelV2.ID[]
  unexpected: ModelV2.ID[]
}

const inspect = Effect.fn("ProviderReady.inspect")(function* (input: Input) {
  const provider = yield* Provider.Service
  const current = (yield* provider.list())[input.providerID]
  const expected = new Set(input.modelIDs)
  const actual = new Set(Object.keys(current?.models ?? {}).map((id) => ModelV2.ID.make(id)))
  const missing = input.modelIDs.filter((id) => !actual.has(id))
  const unexpected = [...actual].filter((id) => !expected.has(id))
  if (missing.length > 0 || unexpected.length > 0) return { ready: false, missing, unexpected }

  return { ready: true, missing, unexpected }
})

export const check = Effect.fn("ProviderReady.check")(function* (input: Input) {
  const first = yield* inspect(input)
  if (first.ready) return first
  yield* ModelsRefresh.notify()
  return yield* inspect(input)
})
