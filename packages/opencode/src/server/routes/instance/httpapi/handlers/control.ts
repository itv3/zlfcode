import { Auth } from "@/auth"
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
    const lifecycle = Log.create({ service: "server" }) // kilocode_change

    // kilocode_change start
    // 审核条目 F36/F41：同步等待 invalidateAfterProviderAuthChange 完成后再返回，
    // 恢复上游「authSet/authRemove 返回即认证已生效」的语义。该函数现已轻量
    // （仅内存级 ModelCache.clear + ModelsRefresh.notify，不销毁实例、不涉及
    // Remote-SSH 断连问题），同步等待的开销可忽略。失败仅记录告警，不让
    // 认证写入本身报错——auth 数据已落盘，缓存失效失败可由后续读取自愈。
    const invalidate = (providerID: ProviderV2.ID) =>
      Effect.gen(function* () {
        if (providerID === "kilo") yield* invalidatePresence()
        yield* invalidateAfterProviderAuthChange(providerID).pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => lifecycle.warn("provider auth invalidation failed", { providerID, cause })),
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
