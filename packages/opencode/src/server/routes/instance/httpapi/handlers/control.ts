import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge" // kilocode_change
import { invalidateAfterProviderAuthChange } from "@/kilocode/server/provider-auth-lifecycle" // kilocode_change
import { ProviderID } from "@/provider/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import { LogInput } from "../groups/control"

export const controlHandlers = HttpApiBuilder.group(RootHttpApi, "control", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const bridge = yield* EffectBridge.make() // kilocode_change
    const lifecycle = Log.create({ service: "server" }) // kilocode_change

    // kilocode_change start
    const invalidate = (providerID: ProviderID) =>
      Effect.sync(() =>
        bridge.fork(
          invalidateAfterProviderAuthChange(providerID, { timeout: "5 seconds" }).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => lifecycle.warn("provider auth invalidation failed", { providerID, cause })),
            ),
          ),
        ),
      )
    // kilocode_change end

    const authSet = Effect.fn("ControlHttpApi.authSet")(function* (ctx: {
      params: { providerID: ProviderID }
      payload: Auth.Info
    }) {
      yield* auth.set(ctx.params.providerID, ctx.payload).pipe(Effect.orDie)
      yield* invalidate(ctx.params.providerID) // kilocode_change
      return true
    })

    const authRemove = Effect.fn("ControlHttpApi.authRemove")(function* (ctx: { params: { providerID: ProviderID } }) {
      yield* auth.remove(ctx.params.providerID).pipe(Effect.orDie)
      yield* invalidate(ctx.params.providerID) // kilocode_change
      return true
    })

    const log = Effect.fn("ControlHttpApi.log")(function* (ctx: { payload: typeof LogInput.Type }) {
      const logger = Log.create({ service: ctx.payload.service })
      logger[ctx.payload.level](ctx.payload.message, ctx.payload.extra)
      return true
    })

    return handlers.handle("authSet", authSet).handle("authRemove", authRemove).handle("log", log)
  }),
)
