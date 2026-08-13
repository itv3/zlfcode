// 复现:编辑已有提供商时 ModelCard 渲染(含变体与「默认推理强度」选择器)
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
const { ModelCard } = await import("../../webview-ui/src/components/settings/CustomProviderModelCard")
const { parseVariant } = await import("../../webview-ui/src/components/settings/CustomProviderDefaults")

// 模拟用户配置里的真实形状(gpt-5.4:五档变体)
const variants = Object.entries({
  none: { reasoningEffort: "none" },
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  xhigh: { reasoningEffort: "xhigh" },
}).map(parseVariant)

const model = {
  id: "gpt-5.4",
  name: "gpt-5.4",
  reasoning: true,
  supportsImages: true,
  modalities: { input: ["text", "image"], output: ["text"] },
  contextLimit: "1050000",
  outputLimit: "128000",
  costEnabled: true,
  inputCost: "2.5",
  outputCost: "15",
  cacheReadCost: "0.25",
  cacheWriteCost: "0",
  variants,
}

const root = document.createElement("div")
document.body.append(root)

const selected: string[] = []
render(
  () => (
    <ModelCard
      m={model as never}
      errors={{}}
      t={(key: string) => key}
      canRemove
      variantNames={variants.map((v) => v.name)}
      onSelectVariant={(v) => selected.push(v)}
      onChangeId={() => {}}
      onChangeName={() => {}}
      onChangeReasoning={() => {}}
      onChangeSupportsImages={() => {}}
      onChangeContextLimit={() => {}}
      onChangeOutputLimit={() => {}}
      onChangeCostEnabled={() => {}}
      onChangeInputCost={() => {}}
      onChangeOutputCost={() => {}}
      onChangeCacheReadCost={() => {}}
      onChangeCacheWriteCost={() => {}}
      onRemove={() => {}}
    />
  ),
  root,
)

const text = root.textContent ?? ""
assert.ok(text.includes("provider.custom.models.variants.default.label"), "默认推理强度标签应渲染")
const inputs = root.querySelectorAll("input")
assert.ok(inputs.length >= 3, `模型卡的输入控件应渲染,实际 ${inputs.length}`)
console.log("MODEL_CARD_RENDER_OK")
