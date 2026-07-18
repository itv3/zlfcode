import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type Mode = "connected" | "catalog"
type Internal = {
  webview: { postMessage: (message: unknown) => Promise<boolean> }
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  cachedConfigMessage: unknown
  cachedProvidersMessage: unknown
  providersRetry: ReturnType<typeof setTimeout> | null
  fetchAndSendProviders: (mode?: Mode) => Promise<void>
  handleProvidersChange: (source: string | undefined, revision: number, message?: unknown) => void
}

function provider(id: string) {
  const model = id === "kilo" ? "kilo-auto/free" : "model"
  return {
    id,
    name: id,
    source: "custom",
    env: [],
    models: {
      [model]: { id: model, name: model, isFree: id === "kilo" },
    },
  }
}

function connected(id: string) {
  return { data: { providers: [provider(id)], default: { [id]: id === "kilo" ? "kilo-auto/free" : "model" } } }
}

function catalog(id: string) {
  return {
    data: {
      all: [provider(id)],
      connected: [],
      default: { [id]: id === "kilo" ? "kilo-auto/free" : "model" },
      failed: [],
    },
  }
}

function deferred<T>() {
  const state = {} as { resolve: (value: T) => void; reject: (error: unknown) => void }
  const promise = new Promise<T>((resolve, reject) => {
    state.resolve = resolve
    state.reject = reject
  })
  return { promise, resolve: state.resolve, reject: state.reject }
}

async function waitFor(check: () => boolean) {
  for (let count = 0; count < 20; count += 1) {
    if (check()) return
    await Bun.sleep(0)
  }
  throw new Error("等待 Provider 请求超时")
}

function subject(input: {
  connected: (call: number, signal?: AbortSignal) => Promise<unknown>
  catalog?: (call: number, signal?: AbortSignal) => Promise<unknown>
  expectsKilo?: boolean
}) {
  const messages: unknown[] = []
  const calls = { connected: 0, catalog: 0 }
  let revision = 0
  const client = {
    config: {
      providers: async (_input: unknown, options: { signal?: AbortSignal }) => {
        calls.connected += 1
        return input.connected(calls.connected, options.signal)
      },
      get: async () => ({ data: {} }),
    },
    provider: {
      list: async (_input: unknown, options: { signal?: AbortSignal }) => {
        calls.catalog += 1
        return input.catalog?.(calls.catalog, options.signal) ?? catalog("catalog")
      },
      auth: async () => ({ data: {} }),
    },
    kilo: {
      authStatus: async () => ({ data: { authenticated: false } }),
    },
  }
  const service = {
    getClient: () => client,
    getProviderRevision: () => revision,
    replaceProviderKeys: () => {},
    setProviderKey: () => {},
  }
  const instance = new KiloProvider({} as never, service as never)
  const internal = instance as unknown as Internal
  internal.connectionState = "connected"
  internal.cachedConfigMessage = input.expectsKilo ? null : { config: { disabled_providers: ["kilo"] } }
  internal.webview = {
    postMessage: async (message) => {
      messages.push(message)
      return true
    },
  }
  return {
    calls,
    internal,
    messages,
    revision: (value: number) => {
      revision = value
    },
  }
}

function loaded(messages: unknown[]) {
  return messages.filter(
    (
      message,
    ): message is {
      type: "providersLoaded"
      mode: Mode
      revision: number
      providers: Record<string, unknown>
    } => !!message && typeof message === "object" && "type" in message && message.type === "providersLoaded",
  )
}

describe("KiloProvider Provider 权威快照", () => {
  it("精确删除会取消失效请求并补拉 connected 权威快照", async () => {
    const item = subject({
      connected: async (call, signal) => {
        if (call > 1) return connected("kilo")
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("请求已取消")), { once: true })
        })
      },
    })

    const pending = item.internal.fetchAndSendProviders()
    await waitFor(() => item.calls.connected === 1)
    item.revision(1)
    item.internal.handleProvidersChange("other", 1, {
      type: "providerDisconnected",
      requestId: "delete-1",
      providerID: "custom",
      removed: true,
      auth: { mode: "clear" },
    })
    await pending

    expect(item.calls.connected).toBe(2)
    expect(loaded(item.messages)).toEqual([expect.objectContaining({ mode: "connected", revision: 1 })])
  })

  it("connected 与 catalog 请求串行返回且分别携带 mode", async () => {
    const gate = deferred<unknown>()
    const item = subject({
      connected: async () => gate.promise,
      catalog: async () => catalog("catalog"),
    })

    const first = item.internal.fetchAndSendProviders("connected")
    await waitFor(() => item.calls.connected === 1)
    const second = item.internal.fetchAndSendProviders("catalog")
    gate.resolve(connected("connected"))
    await Promise.all([first, second])

    expect(item.calls).toEqual({ connected: 1, catalog: 1 })
    expect(loaded(item.messages).map((message) => message.mode)).toEqual(["connected", "catalog"])
    expect(item.internal.cachedProvidersMessage).toEqual(expect.objectContaining({ mode: "connected" }))
    expect(item.internal.providersRetry).toBeNull()
  })

  it("同模式重试会去重排队并在首次失败后自愈", async () => {
    const gate = deferred<void>()
    const item = subject({
      connected: async (call) => {
        if (call > 1) return connected("kilo")
        await gate.promise
        throw new Error("临时失败")
      },
    })

    const first = item.internal.fetchAndSendProviders("connected")
    await waitFor(() => item.calls.connected === 1)
    const retries = [item.internal.fetchAndSendProviders("connected"), item.internal.fetchAndSendProviders("connected")]
    gate.resolve()
    await Promise.all([first, ...retries])

    expect(item.calls.connected).toBe(2)
    expect(loaded(item.messages)).toEqual([expect.objectContaining({ mode: "connected" })])
  })

  it("首轮成功但缺少 Kilo 时会自动退避重试直到免费模型出现", async () => {
    const item = subject({
      connected: async (call) => connected(call === 1 ? "other" : "kilo"),
      expectsKilo: true,
    })

    await item.internal.fetchAndSendProviders("connected")
    expect(item.calls.connected).toBe(1)
    await Bun.sleep(1_100)
    await waitFor(() => loaded(item.messages).at(-1)?.providers.kilo !== undefined)

    expect(loaded(item.messages)).toHaveLength(2)
    expect(item.internal.providersRetry).toBeNull()
    expect(item.internal.cachedProvidersMessage).toEqual(
      expect.objectContaining({
        mode: "connected",
        providers: expect.objectContaining({
          kilo: expect.objectContaining({
            models: expect.objectContaining({
              "kilo-auto/free": expect.objectContaining({ isFree: true }),
            }),
          }),
        }),
      }),
    )
  })
})
