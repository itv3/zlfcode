import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import * as Log from "@opencode-ai/core/util/log"
import { Duration, Effect } from "effect" // kilocode_change
import { Event } from "./event"

const log = Log.create({ service: "server" }) // kilocode_change

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
    const dispose = options?.swallowErrors
      ? store.disposeAll().pipe(Effect.catchCause((cause) => Effect.logWarning("global disposal failed", { cause })))
      : store.disposeAll()
    if (options?.timeout) {
      // 超时分支拆为「可中断的 disposeAll + 必然执行的 emitGlobalDisposed」（审核条目 F07/F62）：
      // 超时只中断销毁本身（实例可能部分销毁，记录明确告警），但 global.disposed
      // 事件必须发出——扩展端依赖该事件触发认证变更后的刷新，事件丢失会让
      // 调用方永远等不到状态更新。事件发送放在 Effect.ensuring 的 finalizer 中：
      // finalizer 天然不可中断，且在成功、超时中断、甚至调用方 fiber 被外部中断
      //（如 HTTP 层传播请求取消）三种收尾路径下都会运行——此前用
      // uninterruptibleMask + restore 的写法在外部中断下事件会丢失（F62）。
      // 注意：dispose 失败（非超时）时 ensuring 也会发事件后再传播错误，与旧结构
      // 的短路跳过不同；本分支唯一调用方（dispose 端点）传 swallowErrors: true，
      // dispose 已被 catchCause 包住不会失败，该差异当前不可达，且「销毁尝试过
      //（可能部分完成）也应通知」与超时路径的语义一致。
      yield* dispose.pipe(
        Effect.timeoutOrElse({
          duration: options.timeout,
          orElse: () =>
            Effect.sync(() =>
              log.warn("global disposal timed out; instances may be partially disposed", {
                timeout: String(options.timeout),
              }),
            ),
        }),
        Effect.ensuring(emitGlobalDisposed),
      )
      return
    }
    yield* Effect.gen(function* () {
      yield* dispose
      yield* emitGlobalDisposed
    }).pipe(Effect.uninterruptible)
  },
  // kilocode_change end
)

export * as GlobalLifecycle from "./global-lifecycle"
