import { describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { KiloConnectionService, resolveRecoveryDelayMs } from "./connection-service"

function state(value: boolean) {
  return {
    get: <T>() => value as T,
    update: async () => undefined,
  }
}

describe("KiloConnectionService sandbox preference", () => {
  test("uses workspace state instead of extension-global state", () => {
    const service = new KiloConnectionService({
      workspaceState: state(false),
      globalState: state(true),
    } as any)

    expect(service.sandboxPreference.resolve(true)).toBe(false)
  })
})

describe("KiloConnectionService clients", () => {
  test("returns a connected client without a workspace folder", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const client = {}
    const workspace = vscode.workspace as { workspaceFolders?: readonly vscode.WorkspaceFolder[] }
    const folders = workspace.workspaceFolders

    ;(service as any).client = client
    ;(service as any).state = "connected"
    workspace.workspaceFolders = undefined

    try {
      expect(await service.getClientAsync()).toBe(client)
    } finally {
      workspace.workspaceFolders = folders
    }
  })
})

describe("KiloConnectionService viewed sessions", () => {
  test("keeps Agent Manager sessions when sidebar visibility changes during a flush", async () => {
    const service = new KiloConnectionService({} as any)
    const calls: Array<{ viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }> = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let max = 0

    ;(service as any).client = {
      session: {
        viewed: async (input: { viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }) => {
          calls.push(input)
          active += 1
          max = Math.max(max, active)
          if (calls.length === 1) await gate
          active -= 1
        },
      },
    }

    service.registerVisible("agent-manager", ["am-1"])
    service.registerAttached("agent-manager", ["am-1", "am-2"])
    await Bun.sleep(175)
    expect(calls).toHaveLength(1)
    expect([...calls[0].visible].sort()).toEqual(["am-1"])
    expect([...calls[0].attached].sort()).toEqual(["am-1", "am-2"])

    service.registerVisible("sidebar", ["side-1"])
    await Bun.sleep(175)
    expect(calls).toHaveLength(1)

    release()
    await Bun.sleep(10)
    expect(max).toBe(1)
    expect([...calls[1].visible].sort()).toEqual(["am-1", "side-1"])
    expect([...calls[1].attached].sort()).toEqual(["am-1", "am-2", "side-1"])

    service.registerVisible("sidebar", [])
    await Bun.sleep(175)
    expect([...calls[2].visible].sort()).toEqual(["am-1"])
    expect([...calls[2].attached].sort()).toEqual(["am-1", "am-2"])
  })

  test("window focus gates viewer.active but not attachment", async () => {
    const window = vscode.window as unknown as {
      state: { focused: boolean }
      onDidChangeWindowState: (listener: (ws: { focused: boolean }) => void) => { dispose(): void }
    }
    const original = window.onDidChangeWindowState
    let listener: ((ws: { focused: boolean }) => void) | undefined
    window.onDidChangeWindowState = (cb) => {
      listener = cb
      return { dispose: () => {} }
    }

    try {
      const service = new KiloConnectionService({} as any)
      const calls: Array<{ viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }> = []
      ;(service as any).client = {
        session: {
          viewed: async (input: (typeof calls)[number]) => {
            calls.push(input)
          },
        },
      }

      service.registerVisible("sidebar", ["ses-1"])
      service.registerAttached("sidebar", ["ses-1", "ses-2"])
      await Bun.sleep(175)
      expect(calls).toHaveLength(1)
      expect(calls[0].viewer.active).toBe(true)

      listener!({ focused: false })
      await Bun.sleep(175)
      expect(calls).toHaveLength(2)
      expect(calls[1].viewer.active).toBe(false)
      expect([...calls[1].visible].sort()).toEqual(["ses-1"])
      expect([...calls[1].attached].sort()).toEqual(["ses-1", "ses-2"])
    } finally {
      window.onDidChangeWindowState = original
    }
  })

  test("sends snapshots while remote control is disabled", async () => {
    const service = new KiloConnectionService({} as any)
    const calls: Array<{ viewer: { id: string; active: boolean }; attached: string[]; visible: string[] }> = []
    ;(service as any).client = {
      session: {
        viewed: async (input: (typeof calls)[number]) => {
          calls.push(input)
        },
      },
    }
    service.setRemoteService({
      getState: () => ({ enabled: false, connected: false }),
      onChange: () => () => {},
    } as any)

    service.registerVisible("sidebar", ["ses-1"])
    service.registerAttached("agent-manager", ["ses-2"])
    await Bun.sleep(175)

    expect(calls).toHaveLength(1)
    expect([...calls[0].visible].sort()).toEqual(["ses-1"])
    expect([...calls[0].attached].sort()).toEqual(["ses-1", "ses-2"])
  })
})

describe("KiloConnectionService provider broadcasts", () => {
  test("broadcasts monotonically versioned provider changes to every active listener", () => {
    const service = new KiloConnectionService({} as any)
    const first: Array<{ source?: string; revision: number; message?: unknown }> = []
    const second: Array<{ source?: string; revision: number; message?: unknown }> = []
    const off = service.onProvidersChanged((source, revision, message) => first.push({ source, revision, message }))
    service.onProvidersChanged((source, revision, message) => second.push({ source, revision, message }))
    const message = { type: "providerDisconnected", providerID: "custom" }

    expect(service.notifyProvidersChanged("sidebar", message)).toBe(1)
    off()
    expect(service.notifyProvidersChanged("settings")).toBe(2)

    expect(first).toEqual([{ source: "sidebar", revision: 1, message }])
    expect(second).toEqual([
      { source: "sidebar", revision: 1, message },
      { source: "settings", revision: 2, message: undefined },
    ])
    expect(service.getProviderRevision()).toBe(2)
  })

  test("atomically shares provider keys without exposing mutable state", () => {
    const service = new KiloConnectionService({} as any)
    const key = {
      key: "sk-old",
      baseURL: "https://old.example.com/v1",
      npm: "@ai-sdk/openai-compatible" as const,
    }
    service.replaceProviderKeys({ custom: key })

    const copy = service.getProviderKeys()
    delete copy.custom
    expect(service.getProviderKeys()).toEqual({ custom: key })

    service.setProviderKey("custom", { ...key, key: "sk-new", baseURL: "https://new.example.com/v1" })
    expect(service.getProviderKeys().custom).toEqual({
      ...key,
      key: "sk-new",
      baseURL: "https://new.example.com/v1",
    })
    service.setProviderKey("custom")
    expect(service.getProviderKeys()).toEqual({})
  })
})

describe("KiloConnectionService provider save queue", () => {
  test("serializes saves and continues after a failure", async () => {
    const service = new KiloConnectionService({} as any)
    const calls: string[] = []
    let begin = () => undefined
    const started = new Promise<void>((resolve) => {
      begin = resolve
    })
    let release = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = service.enqueue(async () => {
      calls.push("first:start")
      begin()
      await gate
      calls.push("first:end")
      throw new Error("failed")
    })
    const second = service.enqueue(async () => {
      calls.push("second")
      return "done"
    })

    await started
    expect(calls).toEqual(["first:start"])
    release()
    await expect(first).rejects.toThrow("failed")
    expect(await second).toBe("done")
    expect(calls).toEqual(["first:start", "first:end", "second"])
  })
})

describe("KiloConnectionService drainPendingPrompts", () => {
  test("ignores stale NotFoundError replies while draining permissions", async () => {
    const service = new KiloConnectionService({} as any)
    const client = {
      project: {
        list: async () => ({ data: [] }),
      },
      permission: {
        list: async () => ({ data: [{ id: "per_test" }] }),
        reply: async () => ({ error: { name: "NotFoundError", data: { message: "missing" } } }),
      },
      question: {
        list: async () => ({ data: [] }),
      },
      suggestion: {
        list: async () => ({ data: [] }),
      },
      network: {
        list: async () => ({ data: [] }),
      },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => ["/tmp/workspace"])

    await expect(service.drainPendingPrompts()).resolves.toBeUndefined()
  })

  test("drains four directories concurrently and suggestions once", async () => {
    const service = new KiloConnectionService({} as any)
    const dirs = ["/tmp/a", "/tmp/b", "/tmp/c", "/tmp/d", "/tmp/e"]
    const gates = new Map(dirs.map((dir) => [dir, Promise.withResolvers<void>()]))
    const fifth = Promise.withResolvers<void>()
    const calls: string[] = []
    let cleared = 0
    const client = {
      permission: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`permission:${directory}`)
          if (directory === dirs[4]) fifth.resolve()
          await gates.get(directory)!.promise
          return { data: [] }
        },
      },
      question: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`question:${directory}`)
          return { data: [] }
        },
      },
      suggestion: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`suggestion:${directory}`)
          return { data: [] }
        },
      },
      network: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(`network:${directory}`)
          return { data: [] }
        },
      },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => dirs)
    service.onClearPendingPrompts(() => cleared++)

    const pending = service.drainPendingPrompts()
    expect(calls).toEqual(dirs.slice(0, 4).map((dir) => `permission:${dir}`))

    gates.get(dirs[0])!.resolve()
    await fifth.promise
    expect(calls.filter((call) => call.startsWith("permission:"))).toEqual(dirs.map((dir) => `permission:${dir}`))

    for (const gate of gates.values()) gate.resolve()
    await pending

    expect(calls.filter((call) => call.startsWith("suggestion:"))).toEqual([`suggestion:${dirs[0]}`])
    const suggestion = calls.findIndex((call) => call.startsWith("suggestion:"))
    expect(calls.filter((call) => call.startsWith("question:")).every((call) => calls.indexOf(call) < suggestion)).toBe(
      true,
    )
    expect(calls.filter((call) => call.startsWith("network:")).every((call) => calls.indexOf(call) > suggestion)).toBe(
      true,
    )
    expect(cleared).toBe(1)
  })

  test("waits for active drains and skips queued directories after a failure", async () => {
    const service = new KiloConnectionService({} as any)
    const dirs = ["/tmp/a", "/tmp/b", "/tmp/c", "/tmp/d", "/tmp/e"]
    const release = Promise.withResolvers<void>()
    const calls: string[] = []
    let cleared = 0
    const client = {
      permission: {
        list: async ({ directory }: { directory: string }) => {
          calls.push(directory)
          if (directory === dirs[0]) await release.promise
          if (directory === dirs[1]) return { error: "failed" }
          return { data: [] }
        },
      },
      question: { list: async () => ({ data: [] }) },
      suggestion: { list: async () => ({ data: [] }) },
      network: { list: async () => ({ data: [] }) },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => dirs)
    service.onClearPendingPrompts(() => cleared++)

    const pending = service.drainPendingPrompts()
    expect(calls).toEqual(dirs.slice(0, 4))
    expect(
      await Promise.race([
        pending.then(
          () => "settled",
          () => "settled",
        ),
        Promise.resolve("pending"),
      ]),
    ).toBe("pending")
    expect(calls).not.toContain(dirs[4])

    release.resolve()
    await expect(pending).rejects.toThrow(`Failed to list permissions for ${dirs[1]}`)
    expect(calls).not.toContain(dirs[4])
    expect(cleared).toBe(0)
  })
})

describe("KiloConnectionService automatic recovery", () => {
  test("resolveRecoveryDelayMs follows the 1s/5s/30s backoff sequence", () => {
    expect(resolveRecoveryDelayMs(0)).toBe(1_000)
    expect(resolveRecoveryDelayMs(1)).toBe(5_000)
    expect(resolveRecoveryDelayMs(2)).toBe(30_000)
    // 超出序列长度后停留在最长退避。
    expect(resolveRecoveryDelayMs(3)).toBe(30_000)
    expect(resolveRecoveryDelayMs(99)).toBe(30_000)
    // 防御：负数按首个退避处理，空序列返回 0。
    expect(resolveRecoveryDelayMs(-1)).toBe(1_000)
    expect(resolveRecoveryDelayMs(0, [])).toBe(0)
  })

  test("stops automatic recovery after the failure limit and waits for manual retry", async () => {
    const service = new KiloConnectionService({} as any)
    const svc = service as any
    // 注入毫秒级退避，让测试快速跑完 5 轮。
    svc.recoveryBackoffMs = [1, 2, 3]
    let forgets = 0
    svc.serverManager = {
      forgetServer: () => {
        forgets += 1
        return true
      },
      dispose: () => {},
    }
    let attempts = 0
    svc.startConnection = async () => {
      attempts += 1
      throw new Error("start failed")
    }

    // 连续 5 轮自动恢复全部失败。
    for (let i = 0; i < 5; i++) {
      await svc.recover(new Error("backend crashed"))
    }
    expect(attempts).toBe(5)
    expect(forgets).toBe(5)

    // 第 6 次触发：超过上限，不再重建，停在 error 状态提示手动重试。
    await svc.recover(new Error("backend crashed"))
    expect(attempts).toBe(5)
    expect(service.getConnectionState()).toBe("error")
    expect(service.getConnectionError()?.message).toContain("retry manually")
  })

  test("concurrent recover calls during backoff share the same in-flight recovery", async () => {
    const service = new KiloConnectionService({} as any)
    const svc = service as any
    svc.recoveryBackoffMs = [20]
    svc.serverManager = { forgetServer: () => true, dispose: () => {} }
    let attempts = 0
    svc.startConnection = async () => {
      attempts += 1
    }

    const first = svc.recover(new Error("boom"))
    // 退避等待期间再次触发（模拟健康轮询与 exit 事件同时到达）：必须复用同一轮。
    const second = svc.recover(new Error("boom again"))
    expect(second).toBe(first)
    await first
    expect(attempts).toBe(1)
    expect(svc.recoveryAttempts).toBe(1)
  })

  test("resets the failure counter after the connection stays stable", async () => {
    const service = new KiloConnectionService({} as any)
    const svc = service as any
    svc.recoveryAttempts = 3
    svc.recoveryStableResetMs = 10

    svc.scheduleRecoveryReset()
    await Bun.sleep(30)

    expect(svc.recoveryAttempts).toBe(0)
  })

  test("does not reset the counter when the connection is torn down within the stable window", async () => {
    const service = new KiloConnectionService({} as any)
    const svc = service as any
    svc.recoveryAttempts = 3
    svc.recoveryStableResetMs = 10

    svc.scheduleRecoveryReset()
    // 稳定窗口内连接再次被重置：稳定计时必须取消，计数保留以维持退避上限。
    svc.resetConnection()
    await Bun.sleep(30)

    expect(svc.recoveryAttempts).toBe(3)
  })
})

describe("KiloConnectionService SSE disconnect fast probe", () => {
  test("recovers immediately when the backend process is confirmed dead", async () => {
    const service = new KiloConnectionService({} as any)
    const svc = service as any
    svc.config = { baseUrl: "http://127.0.0.1:1", password: "pw" }
    svc.serverManager = { isBackendProcessDead: () => true, dispose: () => {} }
    let recovered = 0
    svc.recover = async () => {
      recovered += 1
    }

    await svc.probeBackendAfterDisconnect("http://127.0.0.1:1", "pw")

    expect(recovered).toBe(1)
  })

  test("does not recover when the backend process is still alive", async () => {
    const service = new KiloConnectionService({} as any)
    const svc = service as any
    svc.config = { baseUrl: "http://127.0.0.1:1", password: "pw" }
    svc.serverManager = { isBackendProcessDead: () => false, dispose: () => {} }
    let recovered = 0
    svc.recover = async () => {
      recovered += 1
    }

    await svc.probeBackendAfterDisconnect("http://127.0.0.1:1", "pw")

    expect(recovered).toBe(0)
  })

  test("ignores probes for a superseded connection config", async () => {
    const service = new KiloConnectionService({} as any)
    const svc = service as any
    svc.config = { baseUrl: "http://127.0.0.1:2", password: "new" }
    svc.serverManager = { isBackendProcessDead: () => true, dispose: () => {} }
    let recovered = 0
    svc.recover = async () => {
      recovered += 1
    }

    // 旧连接的探测请求：config 已被新连接替换，必须忽略。
    await svc.probeBackendAfterDisconnect("http://127.0.0.1:1", "old")

    expect(recovered).toBe(0)
  })
})
