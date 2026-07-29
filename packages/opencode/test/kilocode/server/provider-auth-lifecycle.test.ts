import { expect, test } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
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

// 审核条目 F36/F41：authSet/authRemove 恢复同步等待失效完成的语义——
// invalidateAfterProviderAuthChange 返回时缓存清理与刷新通知必须已经完成，
// 调用方（HTTP handler）返回 true 即代表认证变更已生效。
test("等待缓存清理与刷新通知全部完成后才返回", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<string[]>([])
      const latch = yield* Deferred.make<void>()
      yield* ModelsRefresh.watch(() => Ref.update(events, (items) => [...items, "refresh"]))
      const gated = Layer.mock(ModelCache.Service)({
        clear: (providerID) =>
          Deferred.await(latch).pipe(
            Effect.flatMap(() => Ref.update(events, (items) => [...items, `clear:${providerID}`])),
          ),
      })

      const fiber = yield* invalidateAfterProviderAuthChange("kilo").pipe(Effect.provide(gated), Effect.forkChild)
      yield* Effect.yieldNow
      // clear 未完成前函数不得返回，也不得提前发出刷新通知
      expect(yield* Ref.get(events)).toEqual([])

      yield* Deferred.succeed(latch, undefined)
      yield* Fiber.join(fiber)
      expect(yield* Ref.get(events)).toEqual(["clear:kilo", "refresh"])
    }).pipe(Effect.scoped),
  )
})
