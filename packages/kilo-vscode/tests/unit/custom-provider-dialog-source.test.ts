import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as path from "path"

// CustomProviderDialog 是大型 Solid 组件,无法在无 DOM 的 bun 环境中挂载渲染;
// 组件内部的集成点用源码文本断言锁定(与 providers-tab-source.test.ts 同风格),
// 纯函数行为(autoFillModel / revertAutoFill 等)由 custom-provider-defaults.test.ts 覆盖。

const root = path.join(__dirname, "../..")

function src(file: string) {
  return fs.readFileSync(path.join(root, file), "utf-8")
}

describe("CustomProviderDialog source", () => {
  const dialog = src("webview-ui/src/components/settings/CustomProviderDialog.tsx")

  it("自动填充统一走 mergeModelDefaults 语义,不再保留第二套只补空字段实现", () => {
    // F29:dialog 内曾有与 CustomProviderDefaults 同名同义的 flag/field/apply
    // 双实现,一旦漂移会让自动发现与手输 ID 两条路径行为不一致。
    expect(dialog).toContain("autoFillModel(model, id, effective)")
    expect(dialog).not.toMatch(/function flag\(/)
    expect(dialog).not.toMatch(/function field\(/)
  })

  it("模型 ID 变化导致精确命中失效时回收自动填充的默认参数", () => {
    // F04:途经前缀命中(如输入 glm-5.2-max 途经 glm-5.2)填入的错误默认值
    // 必须在命中失效时回收,否则会被静默保存。
    expect(dialog).toContain("const record = autoFill.get(i)")
    expect(dialog).toContain("if (record && record.id !== id) revert(i, record)")
    expect(dialog).toContain("revertAutoFill(model, record)")
  })

  it("用户显式取消的 reasoning 勾选不会被默认值强制勾回", () => {
    // F04:onChangeReasoning 记录取消行为,apply 时剥离 reasoning/variants 默认值。
    expect(dialog).toContain("reasoningDeclined.has(i) ? stripReasoningDefaults(defaults) : defaults")
    expect(dialog).toContain("reasoningDeclined.add(i())")
  })

  it("apply/choose 写入字段值后清除对应字段的旧校验错误", () => {
    // F30:提交失败留下的 limit/cost 错误文案,不能悬挂在已被替换为合法值的输入框旁。
    expect(dialog).toContain("clearModelErrors(i, autoFillErrorKeys(record))")
    expect(dialog).toContain("clearModelErrors(i, MODEL_VALUE_ERROR_KEYS)")
  })

  it("addSelected 只在统一的状态分支里设置 fetch.added 一次", () => {
    // F31:引入候选推荐时遗留的重复 setFetchStatus 已删除,
    // 状态文案只保留统一分支里的一处。
    const hits = dialog.split("provider.custom.models.fetch.added").length - 1
    expect(hits).toBe(1)
  })

  it("auth 状态通过 createMemo 保持响应式", () => {
    // F32:authStates 可能在对话框打开后才到达,一次性快照会丢失"已保存 key"占位提示。
    expect(dialog).toContain("const auth = createMemo(() => resolveAuth(props.existing, provider.authStates()))")
    expect(dialog).toContain('auth() === "api"')
  })
})
