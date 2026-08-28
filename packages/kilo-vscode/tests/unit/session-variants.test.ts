import { describe, expect, it } from "bun:test"
import { createSessionVariants } from "../../webview-ui/src/context/session-variants"
import type { ExtensionMessage, ModelSelection } from "../../webview-ui/src/types/messages"

const model: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }

function setup(session?: string, configured?: string) {
  const config = { model: "anthropic/claude-sonnet-4", variant: configured }
  const selections: Record<string, string> = {}
  const messages: Array<{ type: string; key?: string; value?: string }> = []
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
    order,
    found,
    dispatch: (message: ExtensionMessage) => handler?.(message),
  }
}

describe("session variants", () => {
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

  it("uses updated configuration ahead of remembered defaults for new tabs", () => {
    const state = setup("pending-new", "high")
    state.selections["agent/code/anthropic/claude-sonnet-4"] = "low"
    expect(state.variants.current()).toBe("high")
    state.config.variant = "max"
    expect(state.variants.current()).toBe("max")
    expect(state.variants.request()).toBe("max")
    expect(state.variants.agent("code", model)).toBe("max")
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

  it.each(["sidebar-pending:new", "pending:new"])("keeps a pre-submit Default choice scoped to %s", (id) => {
    const state = setup(undefined, "max")
    state.variants.select(undefined, id)
    expect(state.variants.current(id)).toBeUndefined()
    expect(state.variants.request(id)).toBe("")
    expect(state.variants.current("another-draft")).toBe("max")
    expect(state.messages).toEqual([])
  })

  it("persists global selections but keeps session selections local", () => {
    const global = setup()
    global.variants.select("high")
    expect(global.messages).toEqual([
      { type: "persistVariant", key: "agent/code/anthropic/claude-sonnet-4", value: "high" },
    ])

    const scoped = setup("session-a")
    scoped.variants.select("low")
    expect(scoped.selections).toEqual({ "session/session-a/anthropic/claude-sonnet-4": "low" })
    expect(scoped.messages).toEqual([])
  })

  it("persists an explicit default selection", () => {
    const state = setup()
    state.selections["agent/code/anthropic/claude-sonnet-4"] = "high"
    state.variants.select(undefined)
    expect(state.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "" })
    expect(state.variants.current()).toBeUndefined()
    expect(state.messages).toEqual([{ type: "persistVariant", key: "agent/code/anthropic/claude-sonnet-4", value: "" }])
  })

  // kilocode_change start - ZLF 契约：carry 绝不写入默认 sentinel。undefined（从未选择）
  // 与 DEFAULT_VARIANT（显式默认）都不写入——一旦写入会把新模型的「默认推理强度」
  // （编译层打标的 defaultVariant）永久锁死为裸发。v7.4.23 起上游 carry 同语义
  //（preserveVariant 对 falsy 返回 undefined），此处守护防上游回退。
  it("does not persist anything when carrying an implicit default", () => {
    const state = setup()
    state.variants.carry(model, undefined, "code")
    expect(state.selections).toEqual({})
  })

  it("does not persist anything when carrying an explicit default", () => {
    const state = setup()
    state.variants.carry(model, "", "code")
    expect(state.selections).toEqual({})
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
