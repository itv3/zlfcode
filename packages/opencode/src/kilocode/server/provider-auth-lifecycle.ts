import { ModelCache } from "@/provider/model-cache"
import { KiloViewers } from "@/kilocode/presence/service" // kilocode_change
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import * as Log from "@opencode-ai/core/util/log"
import { Duration, Effect } from "effect"

const log = Log.create({ service: "server" })

export const disposeAllInstancesAfterProviderAuthCallback = Effect.fn(
  "KiloServer.disposeAllInstancesAfterProviderAuthCallback",
)(function* (options?: { providerID?: string; timeout?: Duration.Input }) {
  const mod = yield* Effect.promise(() => import("@/project/instance-store"))
  const store = yield* mod.InstanceStore.Service
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

// kilocode_change start - drop the old presence socket; callers invoke this for the "kilo" provider only
export const invalidatePresence = Effect.fn("KiloServer.invalidatePresence")(function* () {
  const viewers = yield* KiloViewers.Service
  yield* viewers.invalidateAuth()
})
// kilocode_change end

export const invalidateAfterProviderAuthChange = Effect.fn("KiloServer.invalidateAfterProviderAuthChange")(function* (
  providerID: string,
  _options?: { timeout?: Duration.Input },
) {
  const cache = yield* ModelCache.Service
  yield* cache.clear(providerID)
  // API key 变更只需要重建 provider/model 缓存；这里不再销毁实例，避免 Remote-SSH
  // 在保存自定义 provider 的过程中被主动断开。
  yield* ModelsRefresh.notify()
})
