/**
 * F17 / F18：扩展身份解析测试。
 *
 * - F17：self() 未传 ExtensionContext 时，回退查找链首位必须是当前发布身份
 *   itv3.zlfcode（EXTENSION_ID 常量），保证任何未传 ctx 的调用点也能解析到扩展，
 *   version() 不会返回 "unknown"。
 * - F18：agent-manager/vscode-host.ts 的 extensionKeybindings() 必须经由
 *   extension-info 的 self(ctx) 解析扩展（优先 ctx.extension），
 *   不得再硬编码上游扩展 ID kilocode.kilo-code。
 */
import { describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import fs from "node:fs"
import path from "node:path"
import { self, version, EXTENSION_ID } from "../../src/extension-info"

const mockExtensions = vscode.extensions as unknown as {
  getExtension: (id: string) => unknown
}

/** 临时替换全局 vscode mock 的 getExtension，结束后恢复，避免污染其他测试。 */
async function withGetExtension<T>(
  impl: (id: string) => unknown,
  run: () => T | Promise<T>,
): Promise<{ result: T; queried: string[] }> {
  const original = mockExtensions.getExtension
  const queried: string[] = []
  mockExtensions.getExtension = (id: string) => {
    queried.push(id)
    return impl(id)
  }
  try {
    const result = await run()
    return { result, queried }
  } finally {
    mockExtensions.getExtension = original
  }
}

describe("extension-info self()", () => {
  it("EXTENSION_ID 与 package.json 的 publisher.name 保持单一来源", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, "../../package.json"), "utf-8")) as {
      publisher: string
      name: string
    }
    expect(EXTENSION_ID).toBe(`${pkg.publisher}.${pkg.name}`)
  })

  it("传入 ctx 时优先返回 ctx.extension，不做任何 ID 查找", async () => {
    const ctxExtension = { packageJSON: { version: "1.2.3" } }
    const ctx = { extension: ctxExtension } as never
    const { result, queried } = await withGetExtension(
      () => undefined,
      () => self(ctx),
    )
    expect(result).toBe(ctxExtension as never)
    expect(queried).toEqual([])
  })

  it("未传 ctx 时回退链首位查找当前扩展 ID itv3.zlfcode", async () => {
    const current = { packageJSON: { version: "9.9.9" } }
    const { result, queried } = await withGetExtension(
      (id) => (id === EXTENSION_ID ? current : undefined),
      () => self(),
    )
    expect(queried[0]).toBe("itv3.zlfcode")
    expect(result).toBe(current as never)
  })

  it("当前 ID 未命中时依次回退旧身份和上游身份", async () => {
    const upstream = { packageJSON: { version: "0.0.1" } }
    const { result, queried } = await withGetExtension(
      (id) => (id === "kilocode.kilo-code" ? upstream : undefined),
      () => self(),
    )
    expect(queried).toEqual(["itv3.zlfcode", "itv3.kilo-code-plus", "kilocode.kilo-code"])
    expect(result).toBe(upstream as never)
  })

  it("version() 在当前扩展 ID 可解析时不返回 unknown", async () => {
    const { result } = await withGetExtension(
      (id) => (id === EXTENSION_ID ? { packageJSON: { version: "7.4.16" } } : undefined),
      () => version(),
    )
    expect(result).toBe("7.4.16")
  })
})

describe("vscode-host extensionKeybindings()", () => {
  it("经由 self(ctx) 优先使用 ctx.extension 的 keybindings", async () => {
    const { VscodeHost } = await import("../../src/agent-manager/vscode-host")
    const keybindings = [{ command: "kilo-code.new.focusChatInput", key: "ctrl+l", mac: "cmd+l" }]
    const ctx = { extension: { packageJSON: { contributes: { keybindings } } } }
    const host = new VscodeHost({ fsPath: "/ext" } as never, {} as never, ctx as never, {} as never)
    // 全局 vscode mock 的 getExtension 返回的 packageJSON 没有 keybindings 字段，
    // 因此拿到该数组即证明走的是 ctx.extension 而非硬编码 ID 查找。
    const { result } = await withGetExtension(
      () => undefined,
      () => host.extensionKeybindings(),
    )
    expect(result).toEqual(keybindings)
  })

  it("源码中不再硬编码上游扩展 ID kilocode.kilo-code", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dir, "../../src/agent-manager/vscode-host.ts"), "utf-8")
    expect(source).not.toContain('getExtension("kilocode.kilo-code")')
  })
})
