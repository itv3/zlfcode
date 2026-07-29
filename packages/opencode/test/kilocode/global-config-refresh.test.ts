import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Permission } from "../../src/permission"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { registerDisposer } from "../../src/effect/instance-registry"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const root = Global.Path.config

function app() {
  return Server.Default().app
}

async function patch(target: ReturnType<typeof app>, body: object) {
  return target.request("/global/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function update(target: ReturnType<typeof app>, provider: "kilo" | "openrouter") {
  return patch(target, { indexing: { provider } })
}

// 自定义 Provider 的最小合法 PATCH 载荷（仅 provider 段变化，走热更新路径）。
// 注意 model 条目不能是空对象——空对象会在 schema 合并阶段被剥离。
function customProvider(baseURL: string, models: Record<string, { name: string }>) {
  return {
    provider: {
      zlf: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL, apiKey: "test-key" },
        models,
      },
    },
  }
}

async function providerModels(target: ReturnType<typeof app>, directory: string) {
  const response = await target.request("/config", { headers: { "x-kilo-directory": directory } })
  const body = (await response.json()) as { provider?: Record<string, { models?: Record<string, unknown> }> }
  return Object.keys(body.provider?.zlf?.models ?? {})
}

async function provider(target: ReturnType<typeof app>, directory: string) {
  const response = await target.request("/config", { headers: { "x-kilo-directory": directory } })
  return (await response.json()).indexing?.provider as string | undefined
}

async function config(dir: string, value: object) {
  await Bun.write(path.join(dir, "kilo.json"), JSON.stringify(value))
}

async function edit(target: ReturnType<typeof app>, directory: string) {
  const response = await target.request("/config", { headers: { "x-kilo-directory": directory } })
  const body = (await response.json()) as { permission?: unknown }
  return Permission.evaluate(
    "edit",
    "*",
    Permission.fromConfig((body.permission ?? {}) as Parameters<typeof Permission.fromConfig>[0]),
  ).action
}

afterEach(async () => {
  ;(Global.Path as { config: string }).config = root
  await disposeAllInstances()
  await resetDatabase()
})

describe("global config refresh", () => {
  // 审核条目 F06/F35：仅 provider 段变化的 PATCH 走热更新（自定义 Provider 保存
  // 不重启的核心特性），不得销毁活动实例。
  test("provider-only update hot-reloads existing instance without disposal", async () => {
    await using config = await tmpdir()
    await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
    ;(Global.Path as { config: string }).config = config.path
    await disposeAllInstances()
    const target = app()

    expect((await patch(target, customProvider("https://one.test/v1", { m1: { name: "M1" } }))).status).toBe(200)
    expect(await providerModels(target, workspace.path)).toEqual(["m1"])

    let disposed = false
    const unregister = registerDisposer(async (directory) => {
      if (directory !== workspace.path) return
      disposed = true
    })
    try {
      expect((await patch(target, customProvider("https://one.test/v1", { m1: { name: "M1" }, m2: { name: "M2" } }))).status).toBe(200)
      expect(await providerModels(target, workspace.path)).toEqual(["m1", "m2"])
      await Bun.sleep(50)
      expect(disposed).toBe(false)
    } finally {
      unregister()
    }
  })

  // 审核条目 F06/F35：非 provider 配置（如 mcp 段）变化时保留上游销毁语义——
  // MCP 等实例级服务在构建期快照配置且没有独立失效通道，必须靠实例重建感知新配置。
  test("non-provider update (mcp) disposes active instances", async () => {
    await using config = await tmpdir()
    await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
    ;(Global.Path as { config: string }).config = config.path
    await disposeAllInstances()
    const target = app()

    // 先激活 workspace 实例
    await provider(target, workspace.path)

    let disposed = false
    const unregister = registerDisposer(async (directory) => {
      if (directory !== workspace.path) return
      disposed = true
    })
    try {
      const response = await patch(target, {
        mcp: { docs: { type: "local", command: ["echo", "hi"], enabled: false } },
      })
      expect(response.status).toBe(200)
      // configUpdate 同步等待销毁完成后才返回（上游语义）
      expect(disposed).toBe(true)
    } finally {
      unregister()
    }
  })

  test("update ignores disposal notification failures", async () => {
    await using config = await tmpdir()
    ;(Global.Path as { config: string }).config = config.path
    await disposeAllInstances()
    const target = app()
    const listener = () => {
      throw new Error("listener failed")
    }
    GlobalBus.on("event", listener)
    try {
      expect((await update(target, "kilo")).status).toBe(200)
    } finally {
      GlobalBus.off("event", listener)
    }
  })

  // 审核条目 F44：updateGlobal 已在返回前失效缓存并发出一次 ConfigUpdated；
  // 紧随其后的首次读取不得把自己刚写入的变更误判为「外部修改」而重复失效
  // 并再发一次 ConfigUpdated（每次保存客户端只应收到一个事件、一轮刷新）。
  test("updateGlobal 后首次读取不再重复发出 ConfigUpdated", async () => {
    await using config = await tmpdir()
    await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
    ;(Global.Path as { config: string }).config = config.path
    await disposeAllInstances()
    const target = app()

    // 先完成一次读取，初始化 globalStamp
    await provider(target, workspace.path)

    const events: string[] = []
    const listener = (event: { payload: { type?: string } }) => {
      if (event.payload?.type === "global.config.updated") events.push(event.payload.type)
    }
    GlobalBus.on("event", listener)
    try {
      expect((await patch(target, customProvider("https://one.test/v1", { m1: { name: "M1" } }))).status).toBe(200)
      // PATCH 返回时应恰好发出一次 ConfigUpdated
      expect(events.length).toBe(1)
      // 首次与后续读取都不得再触发额外的 ConfigUpdated
      await providerModels(target, workspace.path)
      await providerModels(target, workspace.path)
      expect(events.length).toBe(1)
    } finally {
      GlobalBus.off("event", listener)
    }
  })

  test("detects external global config edits", async () => {
    await using global = await tmpdir()
    await using workspace = await tmpdir({ config: { formatter: false, lsp: false } })
    ;(Global.Path as { config: string }).config = global.path
    await config(global.path, { permission: { edit: "ask" } })
    await disposeAllInstances()
    const target = app()

    expect(await edit(target, workspace.path)).toBe("ask")

    await config(global.path, { permission: { edit: { "*": "allow" } } })

    expect(await edit(target, workspace.path)).toBe("allow")
  })
})
