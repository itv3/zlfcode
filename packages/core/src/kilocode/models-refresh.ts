import { Effect } from "effect"

type Listener = () => Effect.Effect<void>

const listeners = new Set<Listener>()

export const notify = Effect.fn("ModelsRefresh.notify")(function* () {
  for (const listener of listeners) {
    const result = yield* Effect.exit(listener())
    if (result._tag === "Success") continue
    yield* Effect.logWarning("Provider 模型缓存失效失败", result.cause)
  }
})

export const watch = (listener: Listener) =>
  Effect.gen(function* () {
    listeners.add(listener)
    yield* Effect.addFinalizer(() => Effect.sync(() => listeners.delete(listener)))
  })
