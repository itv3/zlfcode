import { describe, expect, it } from "bun:test"
import path from "node:path"
import type { reconcile } from "../../webview-ui/src/context/provider"

const webview = path.resolve(import.meta.dir, "../../webview-ui")
const field: keyof ReturnType<typeof reconcile> = "providers"

const script = `
  const { reconcile } = await import("./src/context/provider.tsx")

  const provider = (id, name, models) => ({
    id,
    name,
    models: Object.fromEntries(models.map((model) => [model, { id: model, name: model }])),
  })
  const loaded = (providers, connected, authStates = {}) => ({
    type: "providersLoaded",
    providers,
    connected,
    defaults: {},
    defaultSelection: { providerID: "kilo", modelID: "kilo-auto/free" },
    authMethods: {},
    authStates,
  })
  const fail = (message) => {
    console.error(message)
    process.exit(1)
  }
  const added = reconcile(
    loaded({ "13": provider("13", "Provider 13", ["gpt-5.5", "gpt-5.6-sol"]) }, ["13", "13"]),
  )
  if (Object.keys(added.providers["13"].models).join(",") !== "gpt-5.5,gpt-5.6-sol") {
    fail("权威快照没有应用新增模型")
  }
  if (added.connected.join(",") !== "13") fail("连接列表没有去重")
  if (Object.keys(added.optimistic).length !== 0) fail("Provider 乐观状态没有清空")

  const changed = reconcile(
    loaded({ "13": provider("13", "Updated Provider", ["gpt-5.6-sol"]) }, ["13"]),
  )
  if (changed.providers["13"].name !== "Updated Provider") fail("Provider 修改没有生效")
  if (changed.providers["13"].models["gpt-5.5"] !== undefined) fail("已删除模型仍然存在")
  if (changed.providers.removed !== undefined) fail("已删除 Provider 仍然存在")

  const auth = reconcile(
    loaded({ "13": provider("13", "Provider 13", ["gpt-5.5"]) }, ["13"]),
  )
  if (Object.keys(auth.authStates).length !== 0) fail("权威认证状态没有生效")
  if (Object.keys(auth.optimisticAuth).length !== 0) fail("认证乐观状态没有清空")
`

describe("reconcile", () => {
  it("在权威刷新后清除乐观覆盖并接受 Provider 全量变化", () => {
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
