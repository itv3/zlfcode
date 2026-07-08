import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import * as Log from "@opencode-ai/core/util/log"
import { Duration, Effect } from "effect" // kilocode_change
import { Event } from "./event"

const log = Log.create({ service: "server" })

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(
  // kilocode_change start
  function* (options?: { swallowErrors?: boolean; timeout?: Duration.Input }) {
    const store = yield* InstanceStore.Service
    const work = Effect.gen(function* () {
      yield* options?.swallowErrors
        ? store.disposeAll().pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                log.warn("global disposal failed", { cause })
              }),
            ),
          )
        : store.disposeAll()
      yield* emitGlobalDisposed
    })
    if (options?.timeout) {
      yield* work.pipe(
        Effect.timeoutOrElse({
          duration: options.timeout,
          orElse: () => Effect.sync(() => log.warn("global disposal timed out", { timeout: String(options.timeout) })),
        }),
      )
      return
    }
    yield* work.pipe(Effect.uninterruptible)
  },
  // kilocode_change end
)

export * as GlobalLifecycle from "./global-lifecycle"
