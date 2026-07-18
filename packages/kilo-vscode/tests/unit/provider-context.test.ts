import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { reconcile } from "../../webview-ui/src/context/provider"

const webview = path.resolve(import.meta.dir, "../../webview-ui")
const field: keyof ReturnType<typeof reconcile> = "providers"

const script = `
  const {
    applyProviderMessage,
    createProviderRetry,
    initialProviderState,
    mergeProviderCatalog,
    reconcile,
  } = await import("./src/context/provider.tsx")

  const provider = (id, name, models) => ({
    id,
    name,
    models: Object.fromEntries(models.map((model) => [model, { id: model, name: model }])),
  })
  const loaded = (
    revision,
    providers,
    connected,
    authStates = {},
    defaults = {},
    mode = "connected",
    authMethods = {},
  ) => ({
    type: "providersLoaded",
    mode,
    revision,
    providers,
    connected,
    defaults,
    defaultSelection: { providerID: "kilo", modelID: "kilo-auto/free" },
    authMethods,
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

  const ignored = applyProviderMessage(
    added,
    loaded(
      2,
      { "14": provider("14", "目录 Provider", ["catalog-model"]) },
      [],
      { "14": "oauth" },
      {},
      "catalog",
      { "14": [{ type: "oauth", label: "OAuth" }] },
    ),
  )
  if (ignored.providers !== added.providers || ignored.connected !== added.connected) {
    fail("catalog 快照覆盖了 connected 权威状态")
  }
  if (ignored.authMethods["14"]?.[0]?.type !== "oauth" || ignored.authStates["14"] !== "oauth") {
    fail("catalog 快照没有补充认证元数据")
  }
  const preserved = applyProviderMessage(
    ignored,
    loaded(3, { "14": provider("14", "目录 Provider", ["catalog-model"]) }, [], {}, {}, "catalog"),
  )
  if (preserved.authMethods["14"]?.[0]?.type !== "oauth" || preserved.authStates["14"] !== "oauth") {
    fail("catalog 空认证结果清除了已有认证元数据")
  }
  const replaced = applyProviderMessage(
    preserved,
    loaded(4, added.providers, added.connected, {}, {}, "connected", {}),
  )
  if (Object.keys(replaced.authMethods).length !== 0 || Object.keys(replaced.authStates).length !== 0) {
    fail("connected 权威快照没有替换认证元数据")
  }
  const catalog = mergeProviderCatalog(added.providers, {
    "13": provider("13", "目录旧 Provider", ["catalog-model"]),
    "14": provider("14", "目录 Provider", ["catalog-model"]),
  })
  if (catalog["13"].name !== "Provider 13") fail("catalog 覆盖了同 ID 的 connected Provider")
  if (!catalog["14"]) fail("catalog 没有补充未连接 Provider")

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

  const timers = []
  let requests = 0
  const retry = createProviderRetry(
    () => requests++,
    (run, delay) => {
      const timer = { run, delay, active: true }
      timers.push(timer)
      return timer
    },
    (timer) => {
      timer.active = false
    },
  )
  retry.refresh()
  if (requests !== 1 || timers[0].delay !== 3000) fail("首次 Provider 请求或退避时间不正确")
  retry.loaded("catalog")
  if (!timers[0].active) fail("catalog 快照错误停止了 connected 重试")
  timers[0].active = false
  timers[0].run()
  if (requests !== 2 || timers[1].delay !== 10000) fail("Provider 重试没有按退避继续")
  retry.loaded("connected")
  if (timers[1].active) fail("connected 权威快照没有取消重试")
  retry.dispose()
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

  it("只有 connected 快照能完成待处理的 Kilo 模型选择", () => {
    const source = readFileSync(path.resolve(webview, "src/context/session.tsx"), "utf8")
    expect(source).toContain('message.type === "providersLoaded" && message.mode === "connected"')
  })
})
