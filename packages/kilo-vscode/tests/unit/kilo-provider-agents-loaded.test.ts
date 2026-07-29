/**
 * F54：fetchAndSendAgents 下发行为测试。
 *
 * README「智能体中文化与隐藏 orchestrator」章节描述：后端返回 agents 后先调用
 * filterAgents，再生成 agentsLoaded。本测试锁定该契约：
 * - agents（可见列表）与 allAgents（完整列表）都不包含内置 orchestrator；
 * - native === false 的同名自定义 agent 在 allAgents 中保留（filterAgents 的保留语义）；
 * - defaultAgent 回退语义不受过滤影响——后端首位是被隐藏的 orchestrator 时回退到 code。
 */
import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type Internal = {
  webview: { postMessage: (message: unknown) => Promise<boolean> }
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  fetchAndSendAgents: () => Promise<void>
}

interface AgentsLoaded {
  type: "agentsLoaded"
  agents: Array<{ name: string; native?: boolean }>
  allAgents: Array<{ name: string; native?: boolean }>
  defaultAgent: string
}

function agent(name: string, extra: Record<string, unknown> = {}) {
  return { name, description: name, mode: "primary", native: true, ...extra }
}

function subject(agents: Array<Record<string, unknown>>) {
  const messages: unknown[] = []
  const client = {
    app: {
      agents: async () => ({ data: agents }),
    },
  }
  const service = {
    getClient: () => client,
  }
  const instance = new KiloProvider({} as never, service as never)
  const internal = instance as unknown as Internal
  internal.connectionState = "connected"
  internal.webview = {
    postMessage: async (message) => {
      messages.push(message)
      return true
    },
  }
  return { internal, messages }
}

function agentsLoaded(messages: unknown[]): AgentsLoaded | undefined {
  return messages.find(
    (message): message is AgentsLoaded =>
      !!message && typeof message === "object" && "type" in message && message.type === "agentsLoaded",
  )
}

describe("KiloProvider fetchAndSendAgents", () => {
  it("agents 与 allAgents 都经过 filterAgents 过滤内置 orchestrator", async () => {
    const { internal, messages } = subject([
      agent("code"),
      agent("orchestrator"),
      agent("ask"),
      agent("custom-agent", { native: false }),
    ])

    await internal.fetchAndSendAgents()

    const message = agentsLoaded(messages)
    expect(message).toBeDefined()
    expect(message!.agents.map((item) => item.name)).not.toContain("orchestrator")
    expect(message!.allAgents.map((item) => item.name)).toEqual(["code", "ask", "custom-agent"])
  })

  it("native === false 的同名自定义 orchestrator 在 allAgents 中保留", async () => {
    const { internal, messages } = subject([agent("code"), agent("orchestrator", { native: false })])

    await internal.fetchAndSendAgents()

    const message = agentsLoaded(messages)
    expect(message!.allAgents.map((item) => item.name)).toEqual(["code", "orchestrator"])
  })

  it("allAgents 保留 subagent 与 hidden agent（仅 filterAgents，不做可见性过滤）", async () => {
    const { internal, messages } = subject([
      agent("code"),
      agent("compaction", { hidden: true }),
      agent("reviewer", { mode: "subagent" }),
    ])

    await internal.fetchAndSendAgents()

    const message = agentsLoaded(messages)
    expect(message!.agents.map((item) => item.name)).toEqual(["code"])
    expect(message!.allAgents.map((item) => item.name)).toEqual(["code", "compaction", "reviewer"])
  })

  it("后端默认智能体为被隐藏的 orchestrator 时 defaultAgent 回退到 code", async () => {
    const { internal, messages } = subject([agent("orchestrator"), agent("ask"), agent("code")])

    await internal.fetchAndSendAgents()

    const message = agentsLoaded(messages)
    expect(message!.defaultAgent).toBe("code")
    expect(message!.allAgents.map((item) => item.name)).toEqual(["ask", "code"])
  })
})
