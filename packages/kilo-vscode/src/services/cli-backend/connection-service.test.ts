import { describe, expect, test } from "bun:test"
import * as vscode from "vscode"
import { KiloConnectionService } from "./connection-service"

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
  test("keeps Agent Manager sessions when sidebar focus changes during a flush", async () => {
    const service = new KiloConnectionService({} as any)
    const calls: Array<{ focused: string[]; open?: string[] }> = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let max = 0

    ;(service as any).remoteService = { getState: () => ({ enabled: true }) }
    ;(service as any).client = {
      session: {
        viewed: async (input: { focused: string[]; open?: string[] }) => {
          calls.push(input)
          active += 1
          max = Math.max(max, active)
          if (calls.length === 1) await gate
          active -= 1
        },
      },
    }

    service.registerFocused("agent-manager", "am-1")
    service.registerOpen("agent-manager", ["am-1", "am-2"])
    await Bun.sleep(175)
    expect(calls).toEqual([{ focused: ["am-1"], open: ["am-2"] }])

    service.registerFocused("sidebar", "side-1")
    await Bun.sleep(175)
    expect(calls).toHaveLength(1)

    release()
    await Bun.sleep(10)
    expect(max).toBe(1)
    expect(calls[1]).toEqual({ focused: ["am-1", "side-1"], open: ["am-2"] })

    service.unregisterFocused("sidebar")
    await Bun.sleep(175)
    expect(calls[2]).toEqual({ focused: ["am-1"], open: ["am-2"] })
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
})
