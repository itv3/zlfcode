import { describe, expect, it } from "bun:test"
import { createSessionVariants } from "../../webview-ui/src/context/session-variants"
import type { ExtensionMessage, ModelSelection } from "../../webview-ui/src/types/messages"

const model: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }

function setup(session?: string) {
  const selections: Record<string, string> = {}
  const messages: Array<{ type: string; key?: string; value?: string }> = []
  const order: string[] = []
  let handler: ((message: ExtensionMessage) => void) | undefined
  // kilocode_change - found 可注入 defaultVariant，测试 ZLF「默认推理强度」回退
  const found: { variants: Record<string, object>; defaultVariant?: string } = { variants: { low: {}, high: {} } }
  const variants = createSessionVariants({
    selections: () => selections,
    set: (key, value) => {
      selections[key] = value
    },
    selected: () => model,
    session: () => session,
    agent: () => "code",
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
  return { variants, selections, messages, order, found, dispatch: (message: ExtensionMessage) => handler?.(message) }
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
    state.variants.select(undefined)
    expect(state.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "" })
    expect(state.variants.current()).toBeUndefined()
    expect(state.messages).toEqual([{ type: "persistVariant", key: "agent/code/anthropic/claude-sonnet-4", value: "" }])
  })

  // kilocode_change start - 上游用例断言「未显式选择也写入显式默认」，会把新模型的
  // ZLF「默认推理强度」（编译层打标的 defaultVariant）永久锁死为裸发。ZLF 契约：
  // 未显式选择（undefined）不写入；显式默认（DEFAULT_VARIANT）与具体档名照常传播。
  it("does not persist anything when carrying an implicit default", () => {
    const state = setup()
    state.variants.carry(model, undefined, "code")
    expect(state.selections).toEqual({})
  })

  it("carries an explicit default across model changes", () => {
    const state = setup()
    state.variants.carry(model, "", "code")
    expect(state.selections).toEqual({ "agent/code/anthropic/claude-sonnet-4": "" })
  })

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
