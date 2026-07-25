import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge" // kilocode_change
import {
  invalidateAfterProviderAuthChange,
  invalidatePresence,
} from "@/kilocode/server/provider-auth-lifecycle" // kilocode_change
import * as Log from "@opencode-ai/core/util/log" // kilocode_change
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { remove as removeAuth } from "@/kilocode/auth/remove" // kilocode_change

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const bridge = yield* EffectBridge.make() // kilocode_change
    const lifecycle = Log.create({ service: "server" }) // kilocode_change

    // kilocode_change start
    const invalidate = (providerID: ProviderV2.ID) =>
      Effect.gen(function* () {
        if (providerID === "kilo") yield* invalidatePresence()
        yield* Effect.sync(() =>
          bridge.fork(
            invalidateAfterProviderAuthChange(providerID, { timeout: "5 seconds" }).pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => lifecycle.warn("provider auth invalidation failed", { providerID, cause })),
              ),
            ),
          ),
        )
      })
    // kilocode_change end

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      yield* invalidate(ctx.params.providerID) // kilocode_change
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: {
      params: { providerID: ProviderV2.ID }
    }) {
      yield* removeAuth(ctx.params.providerID)
      yield* invalidate(ctx.params.providerID) // kilocode_change
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const write =
        ctx.payload.level === "debug"
          ? Effect.logDebug
          : ctx.payload.level === "info"
            ? Effect.logInfo
            : ctx.payload.level === "warn"
              ? Effect.logWarning
              : Effect.logError
      yield* write(ctx.payload.message).pipe(Effect.annotateLogs(ctx.payload.extra ?? {}))
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
