import * as ProviderReady from "@/kilocode/provider/ready"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { ProviderReadyPayload } from "../groups/provider-ready"

export const providerReadyHandlers = HttpApiBuilder.group(InstanceHttpApi, "provider-ready", (handlers) =>
  Effect.gen(function* () {
    const check = Effect.fn("ProviderReadyHttpApi.check")(function* (ctx: {
      payload: typeof ProviderReadyPayload.Type
    }) {
      return yield* ProviderReady.check(ctx.payload)
    })

    return handlers.handle("check", check)
  }),
)
