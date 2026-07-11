import { describe, expect, it } from "bun:test"
import path from "node:path"
import type { reconcile } from "../../webview-ui/src/context/provider"

const webview = path.resolve(import.meta.dir, "../../webview-ui")
const field: keyof ReturnType<typeof reconcile> = "providers"

const script = `
  const { applyProviderMessage, initialProviderState, reconcile } = await import("./src/context/provider.tsx")

  const provider = (id, name, models) => ({
    id,
    name,
    models: Object.fromEntries(models.map((model) => [model, { id: model, name: model }])),
  })
  const loaded = (revision, providers, connected, authStates = {}, defaults = {}) => ({
    type: "providersLoaded",
    revision,
    providers,
    connected,
    defaults,
    defaultSelection: { providerID: "kilo", modelID: "kilo-auto/free" },
    authMethods: {},
    authStates,
  })
  const fail = (message) => {
    console.error(message)
    process.exit(1)
  }
  const added = reconcile(
    loaded(1, { "13": provider("13", "Provider 13", ["gpt-5.5", "gpt-5.6-sol"]) }, ["13", "13"]),
  )
  if (Object.keys(added.providers["13"].models).join(",") !== "gpt-5.5,gpt-5.6-sol") {
    fail("权威快照没有应用新增模型")
  }
  if (added.connected.join(",") !== "13") fail("连接列表没有去重")
  if (Object.keys(added.optimistic).length !== 0) fail("Provider 乐观状态没有清空")

  const changed = reconcile(
    loaded(2, { "13": provider("13", "Updated Provider", ["gpt-5.6-sol"]) }, ["13"]),
  )
  if (changed.providers["13"].name !== "Updated Provider") fail("Provider 修改没有生效")
  if (changed.providers["13"].models["gpt-5.5"] !== undefined) fail("已删除模型仍然存在")
  if (changed.providers.removed !== undefined) fail("已删除 Provider 仍然存在")

  const auth = reconcile(
    loaded(3, { "13": provider("13", "Provider 13", ["gpt-5.5"]) }, ["13"]),
  )
  if (Object.keys(auth.authStates).length !== 0) fail("权威认证状态没有生效")
  if (Object.keys(auth.optimisticAuth).length !== 0) fail("认证乐观状态没有清空")

  let state = applyProviderMessage(
    initialProviderState(),
    loaded(10, { "13": provider("13", "旧 Provider", ["gpt-5.5"]) }, ["13"], { "13": "api" }, { "13": "gpt-5.5" }),
  )
  state = applyProviderMessage(state, {
    type: "providerConnected",
    revision: 12,
    requestId: "save-1",
    providerID: "13",
    provider: provider("13", "新 Provider", ["gpt-5.6-sol"]),
    auth: { mode: "preserve" },
  })
  const current = state
  state = applyProviderMessage(
    state,
    loaded(11, { "13": provider("13", "迟到旧 Provider", ["gpt-5.5"]) }, ["13"], {}),
  )
  if (state !== current) fail("迟到的 providersLoaded 没有被拒绝")
  if (state.providers["13"].models["gpt-5.5"] !== undefined) fail("迟到快照恢复了已删除模型")
  if (!state.providers["13"].models["gpt-5.6-sol"]) fail("精确保存快照丢失新增模型")
  if (state.defaults["13"] !== "gpt-5.6-sol") fail("删除旧默认模型后没有选择仍可用模型")
  if (state.authStates["13"] !== "api") fail("preserve 错误修改了认证状态")

  state = applyProviderMessage(state, {
    type: "providerConnected",
    revision: 13,
    requestId: "save-2",
    providerID: "13",
    auth: { mode: "set", state: "oauth" },
  })
  if (state.authStates["13"] !== "oauth") fail("set 没有更新认证状态")
  state = applyProviderMessage(state, {
    type: "providerConnected",
    revision: 14,
    requestId: "save-3",
    providerID: "13",
    auth: { mode: "clear" },
  })
  if (state.authStates["13"] !== undefined) fail("clear 没有清除认证状态")

  state = applyProviderMessage(state, {
    type: "providerDisconnected",
    revision: 15,
    requestId: "delete-1",
    providerID: "13",
    removed: true,
    auth: { mode: "clear" },
  })
  if (state.providers["13"] !== undefined) fail("精确删除没有移除 Provider")
  if (state.connected.includes("13")) fail("精确删除没有更新连接列表")
  if (state.defaults["13"] !== undefined) fail("精确删除没有清除 Provider 默认模型")
  state = applyProviderMessage(
    state,
    loaded(14, { "13": provider("13", "迟到删除前 Provider", ["gpt-5.6-sol"]) }, ["13"], { "13": "api" }),
  )
  if (state.providers["13"] !== undefined) fail("迟到快照恢复了已删除 Provider")
`

describe("Provider 消息合并", () => {
  it("接受权威变化并拒绝迟到快照，同时正确处理认证三态", () => {
    expect(field).toBe("providers")
    const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", script], {
      cwd: webview,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = result.stdout.toString() + result.stderr.toString()

    expect(result.exitCode, output).toBe(0)
  })
})
