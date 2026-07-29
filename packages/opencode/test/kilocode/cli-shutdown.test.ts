import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { KiloCli } from "../../src/kilocode/cli/setup"
import { KiloShutdown } from "../../src/kilocode/cli/shutdown"
import { SessionExport } from "../../src/kilocode/session-export"
import { InstanceRuntime } from "../../src/project/instance-runtime"

const calls: string[] = []
const timeouts: Array<number | undefined> = []
let err: unknown
let exit: string | number | null | undefined

describe("KiloCli.shutdown", () => {
  beforeEach(() => {
    calls.length = 0
    timeouts.length = 0
    err = undefined
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
  })

  afterEach(() => {
    process.exitCode = exit
    mock.restore()
  })

  test("keeps telemetry shutdown timeout best-effort and still disposes instances", async () => {
    err = "Timeout while shutting down PostHog. Some events may not have been sent."
    process.exitCode = 0

    await expect(KiloCli.shutdown()).resolves.toBeUndefined()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:0", "session", "telemetry", "dispose"])
    expect(process.exitCode).toBe(0)
  })

  test("preserves failing command exit status", async () => {
    process.exitCode = 1

    await KiloCli.shutdown()

    expect(timeouts).toEqual([2000])
    expect(calls).toEqual(["track:1", "session", "telemetry", "dispose"])
    expect(process.exitCode).toBe(1)
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
    expect(InstanceRuntime.disposeAllInstances).toHaveBeenCalledTimes(1)
  })
})
