import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import {
  type ModelStore,
  type ResolveEnv,
  getSessionModel,
  getSelected,
} from "../../webview-ui/src/context/session-model-store"
import { isModelUsable } from "../../webview-ui/src/context/provider-utils"
import type { ModelSelection, Provider } from "../../webview-ui/src/types/messages"

/**
 * F02 回归锁定测试：provider 瞬时缺失或用户主动断开时，收藏、最近模型和
 * per-agent 选择必须保留（仅在读取/展示路径被过滤），绝不触发持久删除。
 *
 * 背景：此前 webview 侧存在 createStaleModelPruner（session-model-prune.ts），
 * 会在 providers 快照中条目不可见时发送 toggleFavorite remove /
 * clearModelSelection / persistRecents 持久删除用户数据。该 pruner 在
 * (a) 用户断开内置 provider（数据本应仅隐藏、待重连恢复）、
 * (b) kilo gateway 拉取失败的过渡快照、
 * (c) 后端重启 SSE 重连的过渡窗口
 * 三种场景下都会误删且跨窗口传播、无法自动恢复。读取路径
 * （resolveModelSelection 全链校验、sessionModel 防御、ModelSelector 与
 * visibleModels 交集展示）已完整过滤失效条目，因此 pruner 被整体移除。
 */

function makeProvider(id: string, models: string[], free: string[] = []): Provider {
  const result: Provider = { id, name: id, models: {} }
  for (const m of models) {
    result.models[m] = { id: m, name: m, ...(free.includes(m) ? { isFree: true } : {}) }
  }
  return result
}

const KILO_FREE: ModelSelection = { providerID: "kilo", modelID: "stepfun/step-flash:free" }
const OPENAI_GPT: ModelSelection = { providerID: "openai", modelID: "gpt-4o" }
const FALLBACK: ModelSelection = { providerID: "kilo", modelID: "kilo-auto" }

/** 完整快照：kilo（含免费模型）与 openai 均在场。 */
function fullProviders(): Record<string, Provider> {
  return {
    kilo: makeProvider("kilo", ["stepfun/step-flash:free", "anthropic/paid"], ["stepfun/step-flash:free"]),
    openai: makeProvider("openai", ["gpt-4o"]),
  }
}

/** 过渡快照：kilo gateway 拉取失败，快照中缺少 kilo（扩展端会安排重试）。 */
function kiloMissingProviders(): Record<string, Provider> {
  return { openai: makeProvider("openai", ["gpt-4o"]) }
}

function makeEnv(providers: Record<string, Provider>, connected: string[]): ResolveEnv {
  return {
    providers,
    connected,
    fallback: FALLBACK,
    getModeModel: () => null,
    getGlobalModel: () => null,
  }
}

/** 模拟用户既有数据：openai 的会话覆盖、per-agent 选择、最近模型，kilo 免费收藏对应的最近记录。 */
function makeStore(): ModelStore {
  return {
    modelSelections: { code: OPENAI_GPT },
    sessionOverrides: { "session-a": OPENAI_GPT, "session-b": KILO_FREE },
    agentSelections: { "session-a": "code", "session-b": "code" },
    recentModels: [OPENAI_GPT, KILO_FREE],
  }
}

/** 深拷贝快照，用于断言读取路径不修改 store。 */
function snapshot(store: ModelStore): string {
  return JSON.stringify(store)
}

describe("用户断开 provider 后模型数据保留（F02 场景 a）", () => {
  it("断开后读取路径回退，store 数据保持原样", () => {
    const store = makeStore()
    const before = snapshot(store)

    // 断开 openai（providers 仍含 openai，仅 connected 移除，对应 removed=false 的断开语义）
    const env = makeEnv(fullProviders(), [])

    // session-a 的 openai 覆盖失效，回退到最近可用模型（kilo 免费）而非被删除
    expect(getSessionModel(store, env, "session-a", "code")).toEqual(KILO_FREE)
    expect(getSelected(store, env, "session-a", "code")).toEqual(KILO_FREE)

    // 关键断言：读取路径纯过滤，不得修改任何用户数据
    expect(snapshot(store)).toBe(before)
    expect(store.sessionOverrides["session-a"]).toEqual(OPENAI_GPT)
    expect(store.modelSelections["code"]).toEqual(OPENAI_GPT)
    expect(store.recentModels).toEqual([OPENAI_GPT, KILO_FREE])
  })

  it("重连后既有选择自动恢复生效", () => {
    const store = makeStore()

    // 断开期间回退
    expect(getSessionModel(store, makeEnv(fullProviders(), []), "session-a", "code")).toEqual(KILO_FREE)

    // 重连后（connected 恢复）原选择复活，无需任何数据回填
    const reconnected = makeEnv(fullProviders(), ["openai"])
    expect(getSessionModel(store, reconnected, "session-a", "code")).toEqual(OPENAI_GPT)
    expect(getSelected(store, reconnected, "session-a", "code")).toEqual(OPENAI_GPT)
  })
})

describe("kilo 缺失的过渡快照不影响数据（F02 场景 b/c）", () => {
  it("过渡快照下 kilo 免费模型判定为暂不可用，但 store 数据保持原样", () => {
    const store = makeStore()
    const before = snapshot(store)
    const env = makeEnv(kiloMissingProviders(), ["openai"])

    // kilo 免费模型在过渡快照下暂不可用
    expect(isModelUsable(env.providers, env.connected, KILO_FREE)).toBe(false)
    // session-b 的 kilo 覆盖失效，回退到 openai（仍连接）
    expect(getSessionModel(store, env, "session-b", "code")).toEqual(OPENAI_GPT)

    // 关键断言：过渡快照绝不触发数据删除，重试拉取成功后一切恢复
    expect(snapshot(store)).toBe(before)
    expect(store.sessionOverrides["session-b"]).toEqual(KILO_FREE)
    expect(store.recentModels).toContainEqual(KILO_FREE)
  })

  it("kilo 恢复后免费模型选择自动复活", () => {
    const store = makeStore()
    const restored = makeEnv(fullProviders(), ["openai"])
    expect(getSessionModel(store, restored, "session-b", "code")).toEqual(KILO_FREE)
  })

  it("providers 完全为空（启动窗口）时豁免校验，既有选择直接可用", () => {
    const store = makeStore()
    const env = makeEnv({}, [])
    expect(getSessionModel(store, env, "session-a", "code")).toEqual(OPENAI_GPT)
    expect(getSessionModel(store, env, "session-b", "code")).toEqual(KILO_FREE)
  })
})

describe("createStaleModelPruner 已整体移除（防止重新接线）", () => {
  const webviewRoot = path.resolve(import.meta.dir, "../../webview-ui")

  function collectSources(dir: string): string[] {
    const result: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "build") continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        result.push(...collectSources(full))
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        result.push(full)
      }
    }
    return result
  }

  it("session-model-prune.ts 文件已删除", () => {
    expect(fs.existsSync(path.join(webviewRoot, "src/context/session-model-prune.ts"))).toBe(false)
  })

  it("webview 源码不再引用 createStaleModelPruner / session-model-prune", () => {
    for (const file of collectSources(webviewRoot)) {
      const source = fs.readFileSync(file, "utf8")
      expect(source.includes("createStaleModelPruner"), `${file} 不应引用 createStaleModelPruner`).toBe(false)
      expect(source.includes('from "./session-model-prune"'), `${file} 不应导入 session-model-prune`).toBe(false)
    }
  })
})
