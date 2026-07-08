import { describe, expect, it } from "bun:test"
import { createProviderAction } from "../../webview-ui/src/utils/provider-action"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

function createTransport() {
  const sent: WebviewMessage[] = []
  let handler: ((message: ExtensionMessage) => void) | undefined

  return {
    sent,
    receive(message: ExtensionMessage) {
      handler?.(message)
    },
    postMessage(message: WebviewMessage) {
      sent.push(message)
    },
    onMessage(next: (message: ExtensionMessage) => void) {
      handler = next
      return () => {
        if (handler === next) {
          handler = undefined
        }
      }
    },
  }
}

function sentRequest(sent: WebviewMessage[], type: string) {
  return sent.find((message) => message.type === type)
}

describe("createProviderAction", () => {
  it("routes terminal provider messages by request id", () => {
    const transport = createTransport()
    const action = createProviderAction(transport)
    const seen: string[] = []

    action.send(
      {
        type: "connectProvider",
        providerID: "openai",
        apiKey: "sk-test",
      },
      {
        onConnected: (message) => seen.push(`connected:${message.providerID}`),
      },
    )

    const sent = sentRequest(transport.sent, "connectProvider")
    expect(sent?.type).toBe("connectProvider")
    expect("requestId" in (sent ?? {}) ? sent.requestId : "").toBeString()

    const requestId = "requestId" in (sent ?? {}) ? sent.requestId : ""
    transport.receive({
      type: "providerConnected",
      requestId,
      providerID: "openai",
    })
    transport.receive({
      type: "providerConnected",
      requestId,
      providerID: "openai",
    })

    expect(seen).toEqual(["connected:openai"])
    action.dispose()
  })

  it("keeps concurrent requests isolated", () => {
    const transport = createTransport()
    const action = createProviderAction(transport)
    const seen: string[] = []

    action.send(
      {
        type: "authorizeProviderOAuth",
        providerID: "anthropic",
        method: 0,
      },
      {
        onOAuthReady: (message) => seen.push(`oauth:${message.authorization.method}`),
      },
    )
    action.send(
      {
        type: "disconnectProvider",
        providerID: "openai",
      },
      {
        onDisconnected: (message) => seen.push(`disconnect:${message.providerID}`),
      },
    )

    const oauth = sentRequest(transport.sent, "authorizeProviderOAuth")
    const disconnect = sentRequest(transport.sent, "disconnectProvider")
    const oauthId = "requestId" in (oauth ?? {}) ? oauth.requestId : ""
    const disconnectId = "requestId" in (disconnect ?? {}) ? disconnect.requestId : ""

    transport.receive({
      type: "providerDisconnected",
      requestId: disconnectId,
      providerID: "openai",
    })
    transport.receive({
      type: "providerOAuthReady",
      requestId: oauthId,
      providerID: "anthropic",
      authorization: { url: "https://example.com", method: "code", instructions: "Code: 1234" },
    })

    expect(seen).toEqual(["disconnect:openai", "oauth:code"])
    action.dispose()
  })

  it("can drop stale requests", () => {
    const transport = createTransport()
    const action = createProviderAction(transport)
    const seen: string[] = []

    const requestId = action.send(
      {
        type: "saveCustomProvider",
        providerID: "myprovider",
        config: {
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: { "model-1": { name: "Model One" } },
        },
      },
      {
        onError: (message) => seen.push(message.message),
      },
    )

    action.clear(requestId)
    transport.receive({
      type: "providerActionError",
      requestId,
      providerID: "myprovider",
      action: "connect",
      message: "boom",
    })

    expect(seen).toEqual([])
    action.dispose()
  })

  it("reports a timeout when the extension never answers", async () => {
    const transport = createTransport()
    const action = createProviderAction(transport, { timeoutMs: 5 })
    const seen: string[] = []

    action.send(
      {
        type: "saveCustomProvider",
        providerID: "myprovider",
        config: {
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: { "model-1": { name: "Model One" } },
        },
      },
      {
        onError: (message) => seen.push(`${message.action}:${message.providerID}:${message.message}`),
      },
    )

    await Bun.sleep(20)

    expect(seen).toEqual(["connect:myprovider:Provider action timed out."])
    action.dispose()
  })

  it("reports provider request post failures immediately", () => {
    const sent: WebviewMessage[] = []
    const transport = {
      sent,
      postMessage(message: WebviewMessage) {
        if (message.type === "saveCustomProvider") throw new Error("post failed")
        sent.push(message)
      },
      onMessage() {
        return () => {}
      },
    }
    const action = createProviderAction(transport)
    const seen: string[] = []

    action.send(
      {
        type: "saveCustomProvider",
        providerID: "myprovider",
        config: {
          name: "My Provider",
          options: { baseURL: "https://example.com/v1" },
          models: { "model-1": { name: "Model One" } },
        },
      },
      {
        onError: (message) => seen.push(`${message.action}:${message.providerID}:${message.message}`),
      },
    )

    expect(seen).toEqual(["connect:myprovider:post failed"])
    expect(sent).toEqual([])
    action.dispose()
  })
})
