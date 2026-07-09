import { expect, test } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { invalidateAfterProviderAuthChange } from "../../../src/kilocode/server/provider-auth-lifecycle"
import { ModelCache } from "../../../src/provider/model-cache"

function layer(events: Ref.Ref<string[]>) {
  return Layer.mock(ModelCache.Service)({
    clear: (providerID) => Ref.update(events, (items) => [...items, `clear:${providerID}`]),
  })
}

test("clears provider models and notifies after auth changes", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<string[]>([])
      yield* ModelsRefresh.watch(() => Ref.update(events, (items) => [...items, "refresh"]))

      yield* invalidateAfterProviderAuthChange("kilo").pipe(Effect.provide(layer(events)))

      expect(yield* Ref.get(events)).toEqual(["clear:kilo", "refresh"])
    }).pipe(Effect.scoped),
  )
})

test("accepts timeout options without disposing instances", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<string[]>([])
      yield* ModelsRefresh.watch(() => Ref.update(events, (items) => [...items, "refresh"]))

      yield* invalidateAfterProviderAuthChange("kilo", { timeout: "10 millis" }).pipe(Effect.provide(layer(events)))

      expect(yield* Ref.get(events)).toEqual(["clear:kilo", "refresh"])
    }).pipe(Effect.scoped),
  )
})
