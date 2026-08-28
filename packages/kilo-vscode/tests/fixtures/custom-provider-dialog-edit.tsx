// 复现:编辑已有自定义提供商时 CustomProviderDialog 的完整渲染(模型列表是否出现)
import assert from "node:assert/strict"
import { Window } from "happy-dom"

const window = new Window({ url: "http://localhost" })
const style = window.getComputedStyle.bind(window)
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  // 上游 v7.5.6 移除了 IntersectionObserver 特性检测（#13XXX remove redundant
  // observer feature detection），组件在无此 API 的环境直接崩溃，补齐注入。
  IntersectionObserver: window.IntersectionObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  FocusEvent: window.FocusEvent,
  InputEvent: window.InputEvent,
  KeyboardEvent: window.KeyboardEvent,
  MouseEvent: window.MouseEvent,
  PointerEvent: window.PointerEvent,
  getComputedStyle: (node: Element) => {
    const value = style(node)
    Object.defineProperty(value, "animationName", { configurable: true, value: "none" })
    return value
  },
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
})

const { render } = await import("solid-js/web")
const CustomProviderDialog = (await import("../../webview-ui/src/components/settings/CustomProviderDialog")).default

// 与用户机器上 kilo.jsonc 的 3ab provider 同形状(五档变体是旧版「默认推理强度」物化产物)
const efforts = (list: string[]) => Object.fromEntries(list.map((e) => [e, { reasoningEffort: e }]))
const existing = {
  providerID: "3ab",
  name: "3AB",
  config: {
    npm: "@ai-sdk/openai-compatible",
    name: "3AB",
    options: { baseURL: "https://example.test/v1", apiKey: "sk-test" },
    models: {
      "gpt-5.4": {
        name: "gpt-5.4",
        reasoning: true,
        limit: { context: 1050000, output: 128000 },
        cost: { input: 2.5, output: 15, cache_read: 0.25, cache_write: 0 },
        modalities: { input: ["text", "image"], output: ["text"] },
        variants: efforts(["none", "low", "medium", "high", "xhigh"]),
      },
      "gpt-5.5": {
        name: "gpt-5.5",
        reasoning: true,
        variants: efforts(["none", "low", "medium", "high", "xhigh"]),
      },
    },
  },
}

const root = document.createElement("div")
document.body.append(root)

render(() => <CustomProviderDialog existing={existing as never} />, root)

await new Promise((resolve) => setTimeout(resolve, 50))

const html = root.innerHTML
const inputs = [...root.querySelectorAll("input")] as { value: string }[]
const values = inputs.map((i) => i.value)
console.log("input 数:", inputs.length)
console.log("含 gpt-5.4:", values.includes("gpt-5.4"))
console.log("含 默认强度标签:", html.includes("provider.custom.models.variants.default.label"))
assert.ok(values.includes("gpt-5.4"), "编辑态应渲染已有模型 gpt-5.4")
console.log("DIALOG_EDIT_RENDER_OK")
