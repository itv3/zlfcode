import { OpenAIWebSocketPool } from "@/plugin/openai/ws-pool"

type Options = Record<string, unknown>

export type Transport = ReturnType<typeof OpenAIWebSocketPool.createWebSocketFetch>

function enabled(providerID: string, npm: string, options: Options) {
  return providerID !== "openai" && npm === "@ai-sdk/openai" && options.websocket === true
}

/**
 * 将自定义 Provider 的序列化开关转换为运行时 fetch。
 * websocket 是 Kilo 内部选项，不能继续传给 AI SDK。
 */
export function create(providerID: string, npm: string, options: Options) {
  const active = enabled(providerID, npm, options)
  delete options.websocket
  if (!active) return

  const httpFetch = typeof options.fetch === "function" ? (options.fetch as typeof globalThis.fetch) : globalThis.fetch
  return OpenAIWebSocketPool.createWebSocketFetch({ httpFetch })
}

/**
 * 标题生成复用对话 session ID，启用自定义 WebSocket 时强制标题请求走 HTTP。
 */
export function headers(providerID: string, npm: string, options: Options, agent: string): Record<string, string> {
  if (!enabled(providerID, npm, options) || agent !== "title") return {}
  return { [OpenAIWebSocketPool.TITLE_HEADER]: "true" }
}
