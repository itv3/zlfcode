import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { KiloCli } from "../../src/kilocode/cli/setup"
import { KiloShutdown } from "../../src/kilocode/cli/shutdown"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { SessionExport } from "../../src/kilocode/session-export"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { KiloLog } from "../../src/kilocode/log"

const calls: string[] = []
const timeouts: Array<number | undefined> = []
let err: unknown
let drainErr: unknown
let drainCalls = 0
let exit: string | number | null | undefined

// 上游 v7.4.17：setup.ts 在模块作用域一次性注册 ingest drain 任务，
// KiloShutdown.run() 执行后注册表即被清空。本函数按同样行为为单个测试
// 重新注册 drain 任务（对应上游测试的 registerDrain，改为 spyOn 风格）。
function registerDrain() {
  KiloShutdown.register(async () => {
    await KiloSessions.drainIngestForShutdown()
  })
}

// 先清空注册表（setup.ts 导入时的一次性注册，或上一个测试的遗留），
// 再注册本测试自己的 drain 任务，使断言不依赖测试声明顺序。
async function installDrain() {
  await KiloShutdown.run()
  calls.length = 0
  drainCalls = 0
  registerDrain()
}

describe("KiloCli.shutdown", () => {
  beforeEach(() => {
    calls.length = 0
    timeouts.length = 0
    err = undefined
    drainErr = undefined
    drainCalls = 0
    exit = process.exitCode
    process.exitCode = undefined

    spyOn(Telemetry, "trackCliExit").mockImplementation((code?: number) => {
      calls.push(`track:${code ?? "undefined"}`)
    })
    spyOn(Telemetry, "shutdown").mockImplementation(async (timeout?: number) => {
      calls.push("telemetry")
      timeouts.push(timeout)
      if (err) throw err
    })
    spyOn(SessionExport, "shutdown").mockImplementation(async () => {
      calls.push("session")
    })
    spyOn(InstanceRuntime, "disposeAllInstances").mockImplementation(async () => {
      calls.push("dispose")
    })
    // setup.ts 的 drain 任务通过动态 import 取 KiloSessions 单例，
    // 这里 spy 真实模块方法即可拦截到同一实例上的调用。
    spyOn(KiloSessions, "drainIngestForShutdown").mockImplementation(async () => {
      drainCalls += 1
      calls.push("drain")
      if (drainErr) throw drainErr
    })
  })

  afterEach(() => {
    process.exitCode = exit
    mock.restore()
  })

  // 必须保持为本文件第一个测试：setup.ts 导入时只在模块作用域注册一次 drain 任务，
  // KiloShutdown.run() 执行后即清空。仅此测试锚定该一次性注册（以及它带来的
  // drain 先于 dispose 的顺序）；后续测试通过 installDrain() 自行注册，不依赖顺序。
  test("rejects drain without blocking dispose", async () => {
    drainErr = new Error("ingest drain failed")
    process.exitCode = 0

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(drainCalls).toBe(1)
    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:0", "session", "telemetry", "drain", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("keeps telemetry shutdown timeout best-effort and still disposes instances", async () => {
    err = "Timeout while shutting down PostHog. Some events may not have been sent."
    process.exitCode = 0
    await installDrain()

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:0", "session", "telemetry", "drain", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("preserves failing command exit status", async () => {
    process.exitCode = 1
    await installDrain()

    await KiloCli.shutdown()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:1", "session", "telemetry", "drain", "dispose"])
    expect(process.exitCode).toBe(1)
  })

  // 上游 v7.4.19（#12659）：--help/--version 等信息型命令跳过全部启动/停机生命周期。
  // 上游 mock.module 版给 bootstrap 的每一步 mock 记录调用来断言；spyOn 版用
  // KiloLog.init（bootstrap 的首个动作）加 beforeEach 里的 shutdown 系列 spy
  // 达到同等断言强度。注意：本测试会把 setup.ts 模块级 info 标志置为 true，
  // 必须保持为本 describe 的最后一个测试，避免后续 KiloCli.shutdown() 变成 no-op。
  test("skips lifecycle work for parsed informational flags", async () => {
    await installDrain()
    const logInit = spyOn(KiloLog, "init").mockImplementation(() => {})

    for (const flag of ["help", "version"] as const) {
      await KiloCli.bootstrap({ [flag]: true })
      await KiloCli.shutdown()
    }

    expect(logInit).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(timeouts).toEqual([])
  })
})

describe("KiloShutdown.waitForServer", () => {
  // 构造记录 stop 调用参数的伪 server
  const makeServer = () => {
    const stops: Array<boolean | undefined> = []
    return {
      stops,
      server: {
        stop: async (close?: boolean) => {
          stops.push(close)
        },
      },
    }
  }

  beforeEach(() => {
    spyOn(InstanceRuntime, "disposeAllInstances").mockImplementation(async () => {})
    // waitForServer 停机序列（合并上游 v7.4.17 后）会先排空 ingest 再 dispose，
    // 测试中替换为空实现，避免触碰真实 ingest 队列。
    spyOn(KiloSessions, "drainIngestForShutdown").mockImplementation(async () => {})
  })

  afterEach(() => {
    delete process.env["KILO_PARENT_PID"]
    mock.restore()
  })

  test("未设置 KILO_PARENT_PID 时 ppid 变化不触发停机（手动后台运行的 kilo serve 不受影响）", async () => {
    delete process.env["KILO_PARENT_PID"]

    // 模拟父 shell 退出后进程被重新父化：把 process.ppid 临时覆盖为 1（init 进程）
    const original = Object.getOwnPropertyDescriptor(process, "ppid")
    Object.defineProperty(process, "ppid", { configurable: true, enumerable: true, get: () => 1 })
    try {
      const { server, stops } = makeServer()
      let resolved = false
      const wait = KiloShutdown.waitForServer(server, { watchdogIntervalMs: 10 }).then(() => {
        resolved = true
      })

      // 等待超过 parent-watchdog 默认轮询间隔（1000ms）的时间（F74）：
      // 即使修复被回退成忽略 watchdogIntervalMs 参数、固定 1 秒轮询的自建
      // 无门控检测，本窗口也足以让其触发一次，从而被下方断言检出。
      await Bun.sleep(1_200)
      expect(stops).toEqual([])
      expect(resolved).toBe(false)

      // 信号路径必须仍然生效：发出 SIGTERM 后完成优雅停机
      process.emit("SIGTERM", "SIGTERM")
      await wait
      expect(stops).toEqual([true])
    } finally {
      if (original) Object.defineProperty(process, "ppid", original)
      else delete (process as unknown as Record<string, unknown>)["ppid"]
    }
  })

  test("设置 KILO_PARENT_PID 且父进程已死时孤儿检测仍触发优雅停机", async () => {
    // 参照 parent-watchdog.test.ts：spawn 真实进程并 kill，确保该 PID 已经不存在
    const child = Bun.spawn([process.execPath, "-e", "await Bun.sleep(30000)"], { stdout: "ignore", stderr: "ignore" })
    const pid = child.pid
    child.kill("SIGKILL")
    await child.exited
    process.env["KILO_PARENT_PID"] = String(pid)

    const { server, stops } = makeServer()
    await Promise.race([
      KiloShutdown.waitForServer(server, { watchdogIntervalMs: 10 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("孤儿检测未在超时前触发停机")), 5000)),
    ])

    expect(stops).toEqual([true])
    // 合并上游 v7.4.17 后：停机序列先排空 ingest，再 dispose 实例
    expect(KiloSessions.drainIngestForShutdown).toHaveBeenCalledTimes(1)
    expect(InstanceRuntime.disposeAllInstances).toHaveBeenCalledTimes(1)
  })
})
