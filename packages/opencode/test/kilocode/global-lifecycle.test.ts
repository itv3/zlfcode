// kilocode_change - new file
// 审核条目 F07：disposeAllInstancesAndEmitGlobalDisposed 的超时分支必须保证
// global.disposed 事件发出——扩展端依赖该事件触发认证变更后的刷新，超时中断
// 销毁时事件丢失会让调用方永远等不到状态更新。
import { afterEach, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { InstanceStore } from "../../src/project/instance-store"
import { disposeAllInstancesAndEmitGlobalDisposed } from "../../src/server/global-lifecycle"
import { Event } from "../../src/server/event"
import * as Log from "@opencode-ai/core/util/log"

void Log.init({ print: false })

function store(disposeAll: Effect.Effect<void>) {
  return Layer.mock(InstanceStore.Service)({ disposeAll: () => disposeAll })
}

function record(events: string[]) {
  const listener = (event: GlobalEvent) => {
    events.push((event.payload as { type: string }).type)
  }
  GlobalBus.on("event", listener)
  return () => GlobalBus.off("event", listener)
}

let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
})

test("销毁在超时前完成时发出 global.disposed 事件", async () => {
  const events: string[] = []
  let disposed = false
  cleanup = record(events)

  await Effect.runPromise(
    disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true, timeout: "5 seconds" }).pipe(
      Effect.provide(
        store(
          Effect.sync(() => {
            disposed = true
          }),
        ),
      ),
    ),
  )

  expect(disposed).toBe(true)
  expect(events).toContain(Event.Disposed.type)
})

test("销毁超时被中断后仍然发出 global.disposed 事件", async () => {
  const events: string[] = []
  cleanup = record(events)

  // disposeAll 永远挂起，模拟销毁卡死；超时后必须中断销毁并继续发事件
  await Effect.runPromise(
    disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true, timeout: "20 millis" }).pipe(
      Effect.provide(store(Effect.never)),
    ),
  )

  expect(events).toContain(Event.Disposed.type)
})

test("超时分支在调用方 fiber 被外部中断时仍然发出 global.disposed 事件（F62）", async () => {
  const events: string[] = []
  cleanup = record(events)

  // 模拟 HTTP 层传播请求取消：销毁进行中（disposeAll 挂起）时外部中断整个
  // fiber。事件发送位于 Effect.ensuring 的 finalizer 中，中断收尾路径下也必须运行。
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* disposeAllInstancesAndEmitGlobalDisposed({
        swallowErrors: true,
        timeout: "5 seconds",
      }).pipe(Effect.forkChild)
      // 让被 fork 的销毁流程真正启动并挂在 disposeAll 上
      yield* Effect.yieldNow
      yield* Fiber.interrupt(fiber)
    }).pipe(Effect.provide(store(Effect.never))),
  )

  expect(events).toContain(Event.Disposed.type)
})

test("无超时分支保持完整销毁并发出事件", async () => {
  const events: string[] = []
  let disposed = false
  cleanup = record(events)

  await Effect.runPromise(
    disposeAllInstancesAndEmitGlobalDisposed().pipe(
      Effect.provide(
        store(
          Effect.sync(() => {
            disposed = true
          }),
        ),
      ),
    ),
  )

  expect(disposed).toBe(true)
  expect(events).toContain(Event.Disposed.type)
})
