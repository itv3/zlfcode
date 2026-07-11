import { afterEach, describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type Key = { key?: string; env?: string; baseURL: string; npm: "@ai-sdk/openai-compatible" }

type Internals = {
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  handleFetchCustomProviderModels: (msg: Record<string, unknown>) => Promise<void>
}

function provider() {
  const sent: unknown[] = []
  let keys: Record<string, Key> = {}
  const service = {
    sandboxPreference: undefined,
    getProviderKeys: () => ({ ...keys }),
  }
  const subject = new KiloProvider({} as never, service as never)
  const internal = subject as unknown as Internals
  internal.webview = {
    postMessage: async (message: unknown) => {
      sent.push(message)
      return true
    },
  }
  return {
    internal,
    sent,
    setKeys: (next: Record<string, Key>) => {
      keys = { ...next }
    },
  }
}

describe("custom provider model fetch", () => {
  afterEach(() => {
    delete process.env.KILO_TEST_LEAK_KEY
  })

  it("ignores env names from webview messages", async () => {
    process.env.KILO_TEST_LEAK_KEY = "sk-secret"
    const calls: string[] = []
    const prev = globalThis.fetch
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push(headers.get("authorization") ?? "")
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as typeof fetch

    try {
      const { internal, sent } = provider()

      await internal.handleFetchCustomProviderModels({
        type: "fetchCustomProviderModels",
        requestId: "req",
        baseURL: "https://example.com/v1",
        protocol: "openai",
        env: "KILO_TEST_LEAK_KEY",
      })

      expect(calls).toEqual([""])
      expect(sent).toEqual([
        { type: "customProviderModelsFetchStarted", requestId: "req" },
        { type: "customProviderModelsFetched", requestId: "req", models: [] },
      ])
    } finally {
      globalThis.fetch = prev
    }
  })

  it("uses saved provider env only when URL and protocol match", async () => {
    process.env.KILO_TEST_LEAK_KEY = "sk-secret"
    const calls: string[] = []
    const prev = globalThis.fetch
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push(headers.get("authorization") ?? "")
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as typeof fetch

    try {
      const { internal, setKeys } = provider()
      setKeys({
        myprovider: {
          env: "KILO_TEST_LEAK_KEY",
          baseURL: "https://example.com/v1",
          npm: "@ai-sdk/openai-compatible",
        },
      })

      await internal.handleFetchCustomProviderModels({
        type: "fetchCustomProviderModels",
        requestId: "req-1",
        baseURL: "https://example.com/v1",
        protocol: "openai",
        providerID: "myprovider",
      })
      await internal.handleFetchCustomProviderModels({
        type: "fetchCustomProviderModels",
        requestId: "req-2",
        baseURL: "https://example.com/v1",
        protocol: "anthropic",
        providerID: "myprovider",
      })

      expect(calls).toEqual(["Bearer sk-secret", ""])
    } finally {
      globalThis.fetch = prev
    }
  })

  it("uses stored keys only when the saved provider URL matches", async () => {
    const calls: string[] = []
    const prev = globalThis.fetch
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      calls.push(headers.get("authorization") ?? "")
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }) as typeof fetch

    try {
      const { internal, setKeys } = provider()
      setKeys({
        myprovider: { key: "sk-stored", baseURL: "https://example.com/v1", npm: "@ai-sdk/openai-compatible" },
      })

      await internal.handleFetchCustomProviderModels({
        type: "fetchCustomProviderModels",
        requestId: "req-1",
        baseURL: "https://example.com/v1",
        protocol: "openai",
        providerID: "myprovider",
      })
      await internal.handleFetchCustomProviderModels({
        type: "fetchCustomProviderModels",
        requestId: "req-2",
        baseURL: "https://evil.example.net/v1",
        protocol: "openai",
        providerID: "myprovider",
      })

      expect(calls).toEqual(["Bearer sk-stored", ""])
    } finally {
      globalThis.fetch = prev
    }
  })
})
