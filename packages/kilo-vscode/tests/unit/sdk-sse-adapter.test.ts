import { describe, expect, it } from "bun:test"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"
import { SdkSSEAdapter } from "../../src/services/cli-backend/sdk-sse-adapter"
import type { ServerInstance, ServerManager } from "../../src/services/cli-backend/server-manager"
import type { ServerConfig } from "../../src/services/cli-backend/types"

type Opts = {
  onSseError?: (error: unknown) => void
  signal?: AbortSignal
}

type Stream = AsyncGenerator<unknown, void, unknown>

type TestableConnectionService = KiloConnectionService & {
  client: KiloClient | null
  sseClient: SdkSSEAdapter | null
  config: ServerConfig | null
  info: { port: number } | null
  state: "connecting" | "connected" | "disconnected" | "error"
  currentDirectory: string | undefined
  healthFailures: number
  healthPollTimer: ReturnType<typeof setInterval> | null
  recoveryPromise: Promise<void> | null
  serverManager: ServerManager & { instance: ServerInstance | null }
  checkHealth: (baseUrl: string, password: string) => Promise<boolean>
  pollHealth: (baseUrl: string, password: string) => Promise<void>
  recover: (reason: Error) => Promise<void>
  startConnection: (dir: string) => Promise<void>
  doConnect: (dir: string) => Promise<void>
  setState: (state: "connecting" | "connected" | "disconnected" | "error", error?: Error) => void
  handleServerExit: (code: number | null) => void
}

function internal(service: KiloConnectionService) {
  return service as unknown as TestableConnectionService
}

function fakeSse(calls: { reconnects: number; disconnects: number }) {
  return {
    reconnect: () => {
      calls.reconnects += 1
    },
    disconnect: () => {
      calls.disconnects += 1
    },
    dispose: () => undefined,
  } as unknown as SdkSSEAdapter
}

function client(open: (opts: Opts) => Stream): KiloClient {
  return {
    global: {
      event: async (opts: Opts) => ({ stream: open(opts) }),
    },
  } as unknown as KiloClient
}

function event() {
  return {
    directory: "/repo",
    payload: {
      id: "evt_connected",
      type: "server.connected",
      properties: {},
    },
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function aborted(signal?: AbortSignal) {
  if (!signal || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
}

describe("SdkSSEAdapter", () => {
  it("reports connected only after the first SSE event arrives", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const adapter = new SdkSSEAdapter(
      client(async function* (opts) {
        await gate
        yield event()
        await aborted(opts.signal)
      }),
    )
    const states: string[] = []
    const connected = new Promise<void>((resolve) => {
      adapter.onStateChange((state) => {
        states.push(state)
        if (state === "connected") resolve()
      })
    })

    adapter.connect()
    await wait(10)

    expect(states).toEqual(["connecting"])

    release()
    await connected

    expect(states).toEqual(["connecting", "connected"])
    adapter.disconnect()
  })

  it("does not log each streamed event", async () => {
    const log = console.log
    const logs: unknown[][] = []
    console.log = (...args: unknown[]) => logs.push(args)
    let count = 0
    let finish = () => {}
    const received = new Promise<void>((resolve) => {
      finish = resolve
    })
    const adapter = new SdkSSEAdapter(
      client(async function* (opts) {
        for (let i = 0; i < 100; i++) yield event()
        await aborted(opts.signal)
      }),
    )
    adapter.onEvent(() => {
      count += 1
      if (count === 100) finish()
    })

    try {
      adapter.connect()
      await received
      expect(logs.some((args) => args.some((value) => String(value).includes("Event:")))).toBe(false)
    } finally {
      adapter.disconnect()
      console.log = log
    }
  })

  it("backs off reconnects when an SSE fetch fails before opening", async () => {
    const timer = globalThis.setTimeout
    const delays: number[] = []
    let count = 0
    let finish = () => {}
    const reached = new Promise<void>((resolve) => {
      finish = resolve
    })
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === "number" && timeout <= 5_000) {
        delays.push(timeout)
        return timer(handler, 0, ...args)
      }
      return timer(handler, timeout, ...args)
    }) as typeof setTimeout

    const failing = new SdkSSEAdapter(
      client((opts) => {
        count += 1
        if (count === 3) finish()
        return (async function* () {
          opts.onSseError?.(new TypeError("fetch failed"))
        })()
      }),
    )

    try {
      failing.connect()
      await reached
      failing.disconnect()

      expect(delays.slice(0, 2)).toEqual([250, 500])
    } finally {
      failing.disconnect()
      globalThis.setTimeout = timer
    }
  })
})

describe("KiloConnectionService backend crash", () => {
  it("does not finish a backend connection after disposal", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const value = internal(service)
    let release = (_server: ServerInstance) => undefined
    const server = new Promise<ServerInstance>((resolve) => {
      release = resolve
    })
    value.serverManager.getServer = async () => server

    const pending = service.connect("/tmp/workspace")
    service.dispose()
    const instance = { port: 52512, password: "secret", pid: 52512, shared: true }
    value.serverManager.instance = instance
    release(instance)

    await expect(pending).rejects.toThrow("disposed")
    await expect(service.connect("/tmp/workspace")).rejects.toThrow("disposed")
    expect(value.serverManager.instance).toBeNull()
    expect(value.client).toBeNull()
    expect(value.sseClient).toBeNull()
    expect(value.healthPollTimer).toBeNull()
    expect(service.getConnectionState()).toBe("disconnected")
  })

  it("automatically reconnects after the owned backend exits", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const value = internal(service)
    const states: Array<{ state: string; error?: string }> = []
    const calls = { reconnects: 0, disconnects: 0 }
    let starts = 0
    let forgets = 0
    value.client = {} as KiloClient
    value.sseClient = fakeSse(calls)
    value.config = { baseUrl: "http://127.0.0.1:52512", password: "secret" }
    value.info = { port: 52512 }
    value.state = "connected"
    value.currentDirectory = "/tmp/workspace"
    value.serverManager.forgetServer = () => {
      forgets += 1
      return false
    }
    value.startConnection = async () => {
      starts += 1
      value.setState("connecting")
      value.client = {} as KiloClient
      value.sseClient = fakeSse(calls)
      value.config = { baseUrl: "http://127.0.0.1:52513", password: "next" }
      value.info = { port: 52513 }
      value.setState("connected")
    }
    service.onStateChange((state, error) => states.push({ state, error: error?.message }))
    value.handleServerExit(9)
    await value.recoveryPromise

    expect(forgets).toBe(1)
    expect(starts).toBe(1)
    expect(calls.disconnects).toBe(1)
    expect(service.getConnectionState()).toBe("connected")
    expect(service.getServerConfig()?.baseUrl).toBe("http://127.0.0.1:52513")
    expect(service.getServerInfo()).toEqual({ port: 52513 })
    expect(states).toEqual([
      { state: "error", error: "CLI background process exited with code 9. Reconnecting automatically." },
      { state: "connecting", error: undefined },
      { state: "connected", error: undefined },
    ])
    service.dispose()
  })

  it("does not expose an SDK client while a replacement server is connecting", () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const value = internal(service)
    value.client = {} as KiloClient
    value.state = "connecting"

    expect(() => service.getClient()).toThrow("Not connected")
    service.dispose()
  })

  it("keeps the current backend when HTTP stays healthy during an SSE reconnect", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const value = internal(service)
    const calls = { reconnects: 0, disconnects: 0 }
    let starts = 0
    let forgets = 0
    value.client = {} as KiloClient
    value.sseClient = fakeSse(calls)
    value.config = { baseUrl: "http://127.0.0.1:52512", password: "secret" }
    value.info = { port: 52512 }
    value.state = "connecting"
    value.healthFailures = 2
    value.checkHealth = async () => true
    value.serverManager.forgetServer = () => {
      forgets += 1
      return true
    }
    value.startConnection = async () => {
      starts += 1
    }

    await value.pollHealth(value.config.baseUrl, value.config.password)

    expect(value.healthFailures).toBe(0)
    expect(forgets).toBe(0)
    expect(starts).toBe(0)
    expect(calls).toEqual({ reconnects: 0, disconnects: 0 })
    expect(service.getConnectionState()).toBe("connecting")
    service.dispose()
  })

  it("replaces an unavailable shared backend once while SSE is reconnecting", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const value = internal(service)
    const calls = { reconnects: 0, disconnects: 0 }
    let starts = 0
    let forgets = 0
    let release = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    value.client = {} as KiloClient
    value.sseClient = fakeSse(calls)
    value.config = { baseUrl: "http://127.0.0.1:52512", password: "secret" }
    value.info = { port: 52512 }
    value.state = "connecting"
    value.currentDirectory = "/tmp/workspace"
    value.checkHealth = async () => false
    value.serverManager.instance = {
      port: 52512,
      password: "secret",
      pid: 52512,
      shared: true,
    }
    const forget = value.serverManager.forgetServer.bind(value.serverManager)
    value.serverManager.forgetServer = () => {
      forgets += 1
      return forget()
    }
    value.startConnection = async () => {
      starts += 1
      await gate
      value.client = {} as KiloClient
      value.sseClient = fakeSse(calls)
      value.config = { baseUrl: "http://127.0.0.1:52513", password: "next" }
      value.info = { port: 52513 }
      value.setState("connected")
    }

    await value.pollHealth(value.config.baseUrl, value.config.password)
    await value.pollHealth(value.config.baseUrl, value.config.password)
    await value.pollHealth(value.config.baseUrl, value.config.password)
    const recovery = value.recoveryPromise
    expect(recovery).not.toBeNull()
    expect(value.recover(new Error("duplicate"))).toBe(recovery)
    release()
    await recovery

    expect(forgets).toBe(1)
    expect(starts).toBe(1)
    expect(calls.reconnects).toBe(2)
    expect(calls.disconnects).toBe(1)
    expect(value.serverManager.instance).toBeNull()
    expect(service.getConnectionState()).toBe("connected")
    expect(service.getServerInfo()).toEqual({ port: 52513 })
    service.dispose()
  })

  it("waits for an active connect attempt before starting one recovery attempt", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const value = internal(service)
    let attempts = 0
    let fail = (_error: Error) => undefined
    const first = new Promise<void>((_resolve, reject) => {
      fail = reject
    })
    value.doConnect = async () => {
      attempts += 1
      if (attempts === 1) return first
      value.setState("connected")
    }
    value.serverManager.forgetServer = () => false

    const initial = service.connect("/tmp/workspace")
    value.handleServerExit(9)
    const recovery = value.recoveryPromise
    fail(new Error("initial backend exited"))
    await initial.catch(() => undefined)
    await recovery

    expect(attempts).toBe(2)
    expect(value.recoveryPromise).toBeNull()
    expect(service.getConnectionState()).toBe("connected")
    service.dispose()
  })
})

describe("KiloConnectionService SSE startup", () => {
  it("cancels a connection waiting for its first SSE event when disposed", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(new ReadableStream<Uint8Array>(), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })) as typeof fetch
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const value = internal(service)
    value.serverManager.getServer = async () => ({ port: 52512, password: "secret", pid: 52512, shared: true })

    try {
      const pending = service.connect("/tmp/workspace")
      const outcome = pending.then(
        () => "resolved",
        (error) => (error instanceof Error ? error.message : String(error)),
      )
      await wait(10)
      expect(value.sseClient).not.toBeNull()
      service.dispose()

      expect(await Promise.race([outcome, wait(100).then(() => "timeout")])).toContain("disposed")
      expect(value.healthPollTimer).toBeNull()
      expect(service.getConnectionState()).toBe("disconnected")
    } finally {
      service.dispose()
      globalThis.fetch = original
    }
  })

  it("waits through an initial SSE fetch failure until the stream opens", async () => {
    const original = globalThis.fetch
    const chunk = new TextEncoder().encode(
      'data: {"payload":{"id":"evt_connected","type":"server.connected","properties":{}}}\n\n',
    )
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls === 1) throw new TypeError("fetch failed")
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(chunk)
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      )
    }) as typeof fetch

    const service = new KiloConnectionService({} as any)
    ;(service as any).serverManager.getServer = async () => ({ port: 52512, password: "secret", process: {} })

    try {
      await expect(service.connect("/tmp/workspace")).resolves.toBeUndefined()
      expect(calls).toBe(2)
      expect(service.getConnectionState()).toBe("connected")
    } finally {
      service.dispose()
      globalThis.fetch = original
    }
  })
})
