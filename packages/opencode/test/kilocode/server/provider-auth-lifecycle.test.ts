import { expect } from "bun:test"
import { Effect, Fiber, Layer, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { invalidateAfterProviderAuthChange } from "../../../src/kilocode/server/provider-auth-lifecycle"
import { InstanceStore } from "../../../src/project/instance-store"
import { ModelCache } from "../../../src/provider/model-cache"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)

function layer(events: Ref.Ref<string[]>, opts: { hangDispose?: boolean } = {}) {
  return Layer.mergeAll(
    Layer.mock(ModelCache.Service)({
      clear: (providerID) => Ref.update(events, (items) => [...items, `clear:${providerID}`]),
    }),
    Layer.mock(InstanceStore.Service)({
      disposeAll: () =>
        Ref.update(events, (items) => [...items, "dispose"]).pipe(
          Effect.andThen(opts.hangDispose ? Effect.never : Effect.void),
        ),
    }),
  )
}

it.effect("clears provider models, disposes instances, and notifies after auth changes", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<string[]>([])
    yield* ModelsRefresh.watch(() => Ref.update(events, (items) => [...items, "refresh"]))

    yield* invalidateAfterProviderAuthChange("kilo").pipe(Effect.provide(layer(events)))

    expect(yield* Ref.get(events)).toEqual(["clear:kilo", "dispose", "refresh"])
  }),
)

it.effect("continues refresh when provider auth disposal times out", () =>
  Effect.gen(function* () {
    const events = yield* Ref.make<string[]>([])
    yield* ModelsRefresh.watch(() => Ref.update(events, (items) => [...items, "refresh"]))

    const fiber = yield* invalidateAfterProviderAuthChange("kilo", { timeout: "10 millis" }).pipe(
      Effect.provide(layer(events, { hangDispose: true })),
      Effect.forkScoped,
    )
    yield* TestClock.adjust("10 millis")
    yield* Fiber.join(fiber)

    expect(yield* Ref.get(events)).toEqual(["clear:kilo", "dispose", "refresh"])
  }),
)
