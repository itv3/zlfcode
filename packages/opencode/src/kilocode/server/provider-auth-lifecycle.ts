import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import * as Log from "@opencode-ai/core/util/log"
import { Duration, Effect } from "effect"

const log = Log.create({ service: "server" })

export const disposeAllInstancesAfterProviderAuthCallback = Effect.fn(
  "KiloServer.disposeAllInstancesAfterProviderAuthCallback",
)(function* (options?: { providerID?: string; timeout?: Duration.Input }) {
  const store = yield* InstanceStore.Service
  const work = store.disposeAll()
  if (options?.timeout) {
    yield* work.pipe(
      Effect.timeoutOrElse({
        duration: options.timeout,
        orElse: () =>
          Effect.sync(() =>
            log.warn("provider auth disposal timed out", {
              providerID: options.providerID,
              timeout: String(options.timeout),
            }),
          ),
      }),
    )
    return
  }
  yield* work
})

export const invalidateAfterProviderAuthChange = Effect.fn("KiloServer.invalidateAfterProviderAuthChange")(function* (
  providerID: string,
  options?: { timeout?: Duration.Input },
) {
  const cache = yield* ModelCache.Service
  yield* cache.clear(providerID)
  yield* disposeAllInstancesAfterProviderAuthCallback({ providerID, timeout: options?.timeout })
  yield* ModelsRefresh.notify()
})
