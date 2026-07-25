import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { KiloCli } from "../../src/kilocode/cli/setup"
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
