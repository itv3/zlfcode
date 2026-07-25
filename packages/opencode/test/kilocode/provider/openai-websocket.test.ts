import { describe, expect, test } from "bun:test"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { WebSocketServer } from "ws"
import * as KiloOpenAIWebSocket from "../../../src/kilocode/provider/openai-websocket"

describe("自定义 OpenAI Responses WebSocket", () => {
  test("为自定义 Provider 注入真实 WebSocket transport", async () => {
    let connections = 0
    await using server = await createWebSocketServer(() => {
      connections += 1
    })
    const options: Record<string, unknown> = { websocket: true }
    const transport = KiloOpenAIWebSocket.create("3ab", "@ai-sdk/openai", options)
    if (!transport) throw new Error("未创建 WebSocket transport")

    const response = await transport(server.url, {
      method: "POST",
      headers: {
        "x-session-affinity": "session-1",
        authorization: "Bearer test",
      },
      body: JSON.stringify({ stream: true, input: "你好" }),
    })

    expect(await response.text()).toContain("data: [DONE]")
    expect(connections).toBe(1)
    expect(options.websocket).toBeUndefined()
    transport.close()
  })

  test("忽略内置 OpenAI 和非 Responses Provider", () => {
    const builtin: Record<string, unknown> = { websocket: true }
    const compatible: Record<string, unknown> = { websocket: true }

    expect(KiloOpenAIWebSocket.create("openai", "@ai-sdk/openai", builtin)).toBeUndefined()
    expect(KiloOpenAIWebSocket.create("3ab", "@ai-sdk/openai-compatible", compatible)).toBeUndefined()
    expect(builtin.websocket).toBeUndefined()
    expect(compatible.websocket).toBeUndefined()
  })

  test("仅为启用 WebSocket 的自定义标题请求添加 HTTP 回退标记", () => {
    expect(KiloOpenAIWebSocket.headers("3ab", "@ai-sdk/openai", { websocket: true }, "title")).toEqual({
      "x-kilo-title": "true",
    })
    expect(KiloOpenAIWebSocket.headers("3ab", "@ai-sdk/openai", { websocket: true }, "build")).toEqual({})
    expect(KiloOpenAIWebSocket.headers("openai", "@ai-sdk/openai", { websocket: true }, "title")).toEqual({})
  })
})

async function createWebSocketServer(onConnection: () => void) {
  const http = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" })
    response.end("http")
  })
  const server = new WebSocketServer({ server: http })
  server.on("connection", (socket) => {
    onConnection()
    socket.on("message", () => {
      socket.send(JSON.stringify({ type: "response.completed", response: { id: "resp_1" } }))
    })
  })
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve))
  const address = http.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}/v1/responses`,
    async [Symbol.asyncDispose]() {
      for (const socket of server.clients) socket.terminate()
      server.close()
      http.close()
    },
  }
}
