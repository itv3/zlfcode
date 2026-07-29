import * as vscode from "vscode"

/**
 * 当前扩展的完整 ID（publisher.name），与 packages/kilo-vscode/package.json 中的
 * `publisher` 和 `name` 字段保持一致。修改 package.json 中的扩展身份时必须同步更新这里。
 */
export const EXTENSION_ID = "itv3.zlfcode"

/**
 * 解析当前扩展实例。
 *
 * 优先使用调用方传入的 ExtensionContext（最可靠，不依赖任何硬编码 ID）；
 * 未传入时按身份从新到旧回退查找：
 * 1. itv3.zlfcode —— 当前发布身份（F17：缺少此项时，未传 ctx 的调用点会拿到 undefined）；
 * 2. itv3.kilo-code-plus —— 已弃用的旧身份，仅为兼容历史安装保留；
 * 3. kilocode.kilo-code —— 上游身份，本地以上游 ID 开发调试时可兜底。
 */
export function self(ctx?: vscode.ExtensionContext): vscode.Extension<unknown> | undefined {
  return (
    ctx?.extension ??
    vscode.extensions.getExtension(EXTENSION_ID) ??
    vscode.extensions.getExtension("itv3.kilo-code-plus") ??
    vscode.extensions.getExtension("kilocode.kilo-code")
  )
}

export function version(ctx?: vscode.ExtensionContext): string {
  return self(ctx)?.packageJSON?.version ?? "unknown"
}
