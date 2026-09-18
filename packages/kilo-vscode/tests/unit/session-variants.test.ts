import { describe, expect, it } from "bun:test"
import { createSessionVariants } from "../../webview-ui/src/context/session-variants"
import type { ExtensionMessage, ModelSelection } from "../../webview-ui/src/types/messages"

const model: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }

function setup(session?: string, configured?: string) {
  const config = { model: "anthropic/claude-sonnet-4", variant: configured }
  const selections: Record<string, string> = {}
  const messages: Array<{ type: string; key?: string; value?: string }> = []
  const remembered: Array<{ agent: string; model: ModelSelection; variant: string }> = []
  const order: string[] = []
  let handler: ((message: ExtensionMessage) => void) | undefined
  // kilocode_change - found 可注入 defaultVariant，测试 ZLF「默认推理强度」回退
  const found: { variants: Record<string, object>; defaultVariant?: string } = {
    variants: { low: {}, high: {}, max: {} },
  }
  const variants = createSessionVariants({
    selections: () => selections,
    set: (key, value) => {
      selections[key] = value
    },
    selected: () => model,
    session: () => session,
    agent: () => "code",
    config: () => config,
    find: () => found,
    remember: (agent, model, variant) => remembered.push({ agent, model, variant }),
    post: (message) => {
      order.push("post")
      messages.push(message)
    },
    listen: (next) => {
      order.push("listen")
      handler = next
      return () => order.push("unsub")
    },
  })
  return {
    variants,
    config,
    selections,
    messages,
    remembered,
    order,
    found,
    dispatch: (message: ExtensionMessage) => handler?.(message),
  }
}

describe("session variants", () => {
  it("distinguishes an unset effort from an explicit Default selection", () => {
    const state = setup()
    expect(state.variants.saved(model, "code")).toBeUndefined()
    expect(state.variants.choice()).toBeUndefined()
    expect(state.variants.request()).toBe("")
    state.variants.select("")
    expect(state.variants.saved(model, "code")).toBe("")
    expect(state.variants.choice()).toBe("")
    expect(state.variants.request()).toBe("")
  })

  it.each([undefined, "session-a"])("carries explicit Default rather than the target preference for %s", (id) => {
    const state = setup(id, "max")
    state.selections["agent/code/anthropic/claude-sonnet-4"] = "high"
    state.variants.carry(model, "", "code", id)
    expect(state.variants.current(id)).toBeUndefined()
    expect(state.variants.request(id)).toBe("")
  })

  it("subscribes before requesting persisted variants and returns cleanup", () => {
    const state = setup()
    const unsub = state.variants.load()
    expect(state.order).toEqual(["listen", "post"])
    expect(state.messages).toEqual([{ type: "requestVariants" }])
    unsub()
    expect(state.order).toEqual(["listen", "post", "unsub"])
  })

  it("loads global variants without restoring stale session variants", () => {
    const state = setup()
    state.variants.load()
    state.dispatch({
      type: "variantsLoaded",
      variants: { "agent/code/anthropic/claude-sonnet-4": "high", "session/old/model": "low" },
    })
    expect(state.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "high" })
  })

  it("uses the configured agent variant when no picker selection exists", () => {
    const state = setup(undefined, "max")
    expect(state.variants.agent("code", model)).toBe("max")
    expect(state.variants.current()).toBe("max")
    expect(state.variants.request()).toBe("max")
  })

  it("keeps remembered effort when configuration changes for new tabs", () => {
    const state = setup("pending-new", "high")
    state.selections["agent/code/anthropic/claude-sonnet-4"] = "low"
    expect(state.variants.current()).toBe("low")
    state.config.variant = "max"
    expect(state.variants.current()).toBe("low")
    expect(state.variants.request()).toBe("low")
    expect(state.variants.agent("code", model)).toBe("low")
  })

  it("does not apply a configured variant to another model", () => {
    const state = setup("pending-new", "max")
    state.config.model = "anthropic/another-model"
    expect(state.variants.current()).toBeUndefined()
    expect(state.variants.agent("code", model)).toBeUndefined()
  })

  it("sends an explicit model default instead of inheriting the configured agent variant", () => {
    const state = setup("session-a", "max")
    state.variants.select(undefined)
    expect(state.variants.current()).toBeUndefined()
    expect(state.variants.request()).toBe("")
    expect(state.variants.current("session-b")).toBe("max")
    expect(state.variants.request("session-b")).toBe("max")
  })

  it.each(["sidebar-pending:new", "pending:new"])("remembers a pre-submit Default choice from %s", (id) => {
    const state = setup(undefined, "max")
    state.variants.select(undefined, id)
    expect(state.variants.current(id)).toBeUndefined()
    expect(state.variants.request(id)).toBe("")
    expect(state.remembered).toEqual([{ agent: "code", model, variant: "" }])
    expect(state.messages).toEqual([])
  })

  it("persists global selections but keeps session selections local", () => {
    const global = setup()
    global.variants.select("high")
    expect(global.remembered).toEqual([{ agent: "code", model, variant: "high" }])

    const scoped = setup("session-a")
    scoped.variants.select("low")
    expect(scoped.selections).toEqual({ "session/session-a/anthropic/claude-sonnet-4": "low" })
    expect(scoped.messages).toEqual([])
    expect(scoped.remembered).toEqual([])
  })

  it("persists an explicit default selection", () => {
    const state = setup()
    state.selections["agent/code/anthropic/claude-sonnet-4"] = "high"
    state.variants.select(undefined)
    expect(state.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "" })
    expect(state.variants.current()).toBeUndefined()
    expect(state.remembered).toEqual([{ agent: "code", model, variant: "" }])
  })

  // kilocode_change start - ZLF 契约：carry 对 undefined（从未选择）绝不写入默认 sentinel——
  // 一旦写入会把新模型的「默认推理强度」（编译层打标的 defaultVariant）永久锁死为裸发。
  // 显式默认（DEFAULT_VARIANT，用户明确选了「不用推理」）自上游 v7.7.5 起有意跨模型
  // 传播（"preserve effort intent"），与置顶档无冲突：置顶档只在从未选择时兜底。
  it("does not persist anything when carrying an implicit default", () => {
    const state = setup()
    state.variants.carry(model, undefined, "code")
    expect(state.selections).toEqual({})
  })

  it("carries an explicit default across models without touching the model default", () => {
    const state = setup()
    state.found.defaultVariant = "high"
    state.variants.carry(model, "", "code")
    expect(state.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "" })
    // 显式默认已写入 → 裸发；置顶档不介入
    expect(state.variants.current()).toBeUndefined()
  })
  // kilocode_change end

  it("does not shadow a cached variant when carrying the model default", () => {
    const global = setup()
    global.selections["agent/code/anthropic/claude-sonnet-4"] = "high"
    global.variants.carry(model, undefined, "code")
    expect(global.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "high" })
    expect(global.messages).toEqual([])

    const session = setup("session-a")
    session.selections["agent/code/anthropic/claude-sonnet-4"] = "high"
    session.variants.carry(model, undefined, "code", "session-a")
    expect(session.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "high" })
    expect(session.variants.current()).toBe("high")
  })

  // kilocode_change start - ZLF：置顶档（默认推理强度）回退契约
  it("falls back to the model default variant when nothing was chosen", () => {
    const state = setup()
    state.found.defaultVariant = "high"
    expect(state.variants.current()).toBe("high")
    // 显式选择「默认」后回到裸发
    state.variants.select(undefined)
    expect(state.variants.current()).toBeUndefined()
  })
  // kilocode_change end
})
