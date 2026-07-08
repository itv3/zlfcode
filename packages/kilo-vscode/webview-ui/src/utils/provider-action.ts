import type {
  AuthorizeProviderOAuthMessage,
  CompleteProviderOAuthMessage,
  ConnectProviderMessage,
  DisconnectProviderMessage,
  ExtensionMessage,
  ProviderActionErrorMessage,
  ProviderConnectedMessage,
  ProviderDisconnectedMessage,
  ProviderOAuthReadyMessage,
  SaveCustomProviderMessage,
  WebviewMessage,
} from "../types/messages"

type ProviderRequest =
  | ConnectProviderMessage
  | AuthorizeProviderOAuthMessage
  | CompleteProviderOAuthMessage
  | DisconnectProviderMessage
  | SaveCustomProviderMessage

type ProviderRequestInput =
  | Omit<ConnectProviderMessage, "requestId">
  | Omit<AuthorizeProviderOAuthMessage, "requestId">
  | Omit<CompleteProviderOAuthMessage, "requestId">
  | Omit<DisconnectProviderMessage, "requestId">
  | Omit<SaveCustomProviderMessage, "requestId">

type Transport = {
  postMessage: (message: WebviewMessage) => void
  onMessage: (handler: (message: ExtensionMessage) => void) => () => void
}

type Handlers = {
  onOAuthReady?: (message: ProviderOAuthReadyMessage) => void
  onConnected?: (message: ProviderConnectedMessage) => void
  onDisconnected?: (message: ProviderDisconnectedMessage) => void
  onError?: (message: ProviderActionErrorMessage) => void
}

type Pending = {
  handlers: Handlers
  timer: ReturnType<typeof setTimeout>
}

type Options = {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

function action(message: ProviderRequestInput): ProviderActionErrorMessage["action"] {
  if (message.type === "disconnectProvider") return "disconnect"
  if (message.type === "authorizeProviderOAuth") return "authorize"
  return "connect"
}

function encode(message: ProviderRequest) {
  try {
    const text = JSON.stringify(message)
    if (!text) return { error: "Provider request could not be serialized." }
    return {
      payload: JSON.parse(text) as ProviderRequest,
      size: text.length,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export function createProviderAction(vscode: Transport, opts: Options = {}) {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pending = new Map<string, Pending>()
  const unsubscribe = vscode.onMessage((message) => {
    if (!("requestId" in message)) return

    const item = pending.get(message.requestId)
    if (!item) return
    clearTimeout(item.timer)
    pending.delete(message.requestId)

    if (message.type === "providerOAuthReady") {
      item.handlers.onOAuthReady?.(message)
      return
    }

    if (message.type === "providerConnected") {
      item.handlers.onConnected?.(message)
      return
    }

    if (message.type === "providerDisconnected") {
      item.handlers.onDisconnected?.(message)
      return
    }

    if (message.type === "providerActionError") {
      item.handlers.onError?.(message)
    }
  })

  function send(message: ProviderRequestInput, handlers: Handlers = {}) {
    const requestId = crypto.randomUUID()
    const timer = setTimeout(() => {
      const item = pending.get(requestId)
      if (!item) return
      pending.delete(requestId)
      item.handlers.onError?.({
        type: "providerActionError",
        requestId,
        providerID: message.providerID,
        action: action(message),
        message: "Provider action timed out.",
      })
    }, timeout)
    pending.set(requestId, { handlers, timer })
    const encoded = encode({ ...message, requestId } as ProviderRequest)
    if (!encoded.payload) {
      clearTimeout(timer)
      pending.delete(requestId)
      handlers.onError?.({
        type: "providerActionError",
        requestId,
        providerID: message.providerID,
        action: action(message),
        message: encoded.error ?? "Provider request could not be serialized.",
      })
      return requestId
    }
    try {
      vscode.postMessage(encoded.payload)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      clearTimeout(timer)
      pending.delete(requestId)
      handlers.onError?.({
        type: "providerActionError",
        requestId,
        providerID: message.providerID,
        action: action(message),
        message: error,
      })
    }
    return requestId
  }

  function clear(requestId?: string) {
    if (requestId) {
      const item = pending.get(requestId)
      if (item) clearTimeout(item.timer)
      pending.delete(requestId)
      return
    }
    for (const item of pending.values()) clearTimeout(item.timer)
    pending.clear()
  }

  function dispose() {
    clear()
    unsubscribe()
  }

  return { clear, send, dispose }
}
