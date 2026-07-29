/**
 * F21：refreshConnectionData 按 connectionGeneration 去重测试。
 *
 * 首次连接时 onStateChange 的 connected 回调与 initializeConnection 尾部
 * 会先后调用 refreshConnectionData，同一 generation 只应执行一次全量拉取；
 * 重连（generation 递增）后必须重新执行——这是既有的正确行为，不能破坏。
 */
import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type Internal = {
  webview: { postMessage: (message: unknown) => Promise<boolean> }
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  connectionGeneration: number
  memory: { fetch: () => Promise<void> }
  refreshConnectionData: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendIndexingStatus: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  seedSessionStatusMap: () => Promise<void>
  sendNotificationSettings: () => void
  sendTimelineSetting: () => void
  startStatsPolling: () => void
}

function subject() {
  const messages: unknown[] = []
  const counts = { refresh: 0 }
  const client = {
    project: {
      // hasGit 消费点：返回非 git 项目，跳过 startStatsPolling 分支。
      current: async () => ({ data: { vcs: "none" } }),
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
  // 将全量拉取的第一项替换为计数器，其余替换为空实现，
  // 只观察 refreshConnectionData 是否发起了新一轮拉取。
  internal.fetchAndSendProviders = async () => {
    counts.refresh += 1
  }
  internal.fetchAndSendAgents = async () => {}
  internal.fetchAndSendSkills = async () => {}
  internal.fetchAndSendCommands = async () => {}
  internal.fetchAndSendConfig = async () => {}
  internal.fetchAndSendIndexingStatus = async () => {}
  internal.fetchAndSendNotifications = async () => {}
  internal.seedSessionStatusMap = async () => {}
  internal.memory = { fetch: async () => {} }
  internal.sendNotificationSettings = () => {}
  internal.sendTimelineSetting = () => {}
  internal.startStatsPolling = () => {}
  return { internal, counts, messages }
}

function ready(messages: unknown[]) {
  return messages.filter(
    (message) =>
      !!message && typeof message === "object" && "type" in message && message.type === "extensionDataReady",
  )
}

describe("KiloProvider refreshConnectionData", () => {
  it("同一 connectionGeneration 内的重复调用只执行一次全量拉取", async () => {
    const { internal, counts, messages } = subject()

    // 模拟首连:onStateChange connected 回调与 initializeConnection 尾部
    // 两条路径重叠调用(第二次在第一次未完成时发起)。
    await Promise.all([internal.refreshConnectionData(), internal.refreshConnectionData()])
    await internal.refreshConnectionData()

    expect(counts.refresh).toBe(1)
    expect(ready(messages)).toHaveLength(1)
  })

  it("重连（generation 递增）后重新执行全量拉取", async () => {
    const { internal, counts, messages } = subject()

    await internal.refreshConnectionData()
    expect(counts.refresh).toBe(1)

    // 模拟重连:onStateChange 中状态变化会递增 connectionGeneration。
    internal.connectionGeneration += 1
    await internal.refreshConnectionData()

    expect(counts.refresh).toBe(2)
    expect(ready(messages)).toHaveLength(2)
  })

  it("未连接时的调用不消耗当前 generation 的刷新机会", async () => {
    const { internal, counts } = subject()

    internal.connectionState = "connecting"
    await internal.refreshConnectionData()
    expect(counts.refresh).toBe(0)

    internal.connectionState = "connected"
    await internal.refreshConnectionData()
    expect(counts.refresh).toBe(1)
  })
})
