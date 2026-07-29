import { describe, expect, it } from "bun:test"
import { fileURLToPath } from "url"
import { parseMessageFiles, resolveMessageFile } from "../../src/kilo-provider/message-files"

describe("parseMessageFiles", () => {
  it("accepts terminal text attachments with source metadata", () => {
    const files = parseMessageFiles([
      {
        mime: "text/plain",
        url: "data:text/plain;charset=utf-8,terminal%20output",
        filename: "terminal-output.txt",
        source: {
          type: "file",
          path: "terminal-output.txt",
          text: { value: "@terminal", start: 0, end: 9 },
        },
      },
    ])

    expect(files?.[0]?.filename).toBe("terminal-output.txt")
    expect(files?.[0]?.source?.text.value).toBe("@terminal")
  })

  it("rejects unsupported URLs", () => {
    expect(parseMessageFiles([{ mime: "text/plain", url: "https://example.com/file.txt" }])).toBeUndefined()
  })

  it("keeps valid attachments when another attachment is invalid", () => {
    const files = parseMessageFiles([
      { mime: "text/plain", url: "https://example.com/file.txt" },
      { mime: "text/plain", path: "README.md" },
    ])

    expect(files).toHaveLength(1)
    expect(files?.[0]?.path).toBe("README.md")
  })

  it("accepts relative paths for extension-side resolution", () => {
    const files = parseMessageFiles([{ mime: "text/plain", path: "README.md", filename: "README.md" }])

    expect(files?.[0]?.path).toBe("README.md")
  })

  it("resolves relative paths against the session directory", () => {
    const file = parseMessageFiles([{ mime: "text/plain", path: "README.md" }])![0]!
    const part = resolveMessageFile(file, "/repo/worktree")!

    expect(fileURLToPath(part.url)).toBe("/repo/worktree/README.md")
    expect(part.filename).toBeUndefined()
  })

  it("resolves an absolute path that lives inside the session directory", () => {
    // workspace 内绝对路径 mention 的支持：webview 端以 path 原样传来，
    // 扩展端结合会话目录确认归属后生成 file:// URL 附件。
    const file = parseMessageFiles([{ mime: "text/plain", path: "/repo/worktree/src/main.ts" }])![0]!
    const part = resolveMessageFile(file, "/repo/worktree")!

    expect(part).toBeDefined()
    expect(fileURLToPath(part.url)).toBe("/repo/worktree/src/main.ts")
  })

  it("drops an absolute path outside the session directory", () => {
    // 会话目录外的文件不允许自动附加（自动附加会绕过权限系统），
    // 模型必须改用 Read 工具在正常权限检查下读取。
    const file = parseMessageFiles([{ mime: "text/plain", path: "/outside/secret.txt" }])![0]!

    expect(resolveMessageFile(file, "/repo/worktree")).toBeUndefined()
  })

  it("drops an absolute path that escapes the session directory via ../ segments", () => {
    const file = parseMessageFiles([{ mime: "text/plain", path: "/repo/worktree/../../etc/passwd" }])![0]!

    expect(resolveMessageFile(file, "/repo/worktree")).toBeUndefined()
  })

  it("drops a relative path that escapes the session directory via ../ segments", () => {
    const file = parseMessageFiles([{ mime: "text/plain", path: "../../etc/passwd" }])![0]!

    expect(resolveMessageFile(file, "/repo/worktree")).toBeUndefined()
  })

  it("drops the parent directory itself (rel is exactly '..')", () => {
    // F60 边界：rel 恰为 ".."（无分隔符后缀）走 `rel === ".."` 分支，同样越界。
    const relative = parseMessageFiles([{ mime: "text/plain", path: ".." }])![0]!
    expect(resolveMessageFile(relative, "/repo/worktree")).toBeUndefined()

    const absolute = parseMessageFiles([{ mime: "text/plain", path: "/repo" }])![0]!
    expect(resolveMessageFile(absolute, "/repo/worktree")).toBeUndefined()
  })

  it("keeps files whose name merely starts with dots (F60 regression)", () => {
    // 越界判定必须区分「路径段就是 ..」与「文件名恰好以 .. 开头」：
    // /repo/worktree/..config 的 rel 为 "..config"，以 ".." 开头但并未越界。
    const file = parseMessageFiles([{ mime: "text/plain", path: "/repo/worktree/..config" }])![0]!
    const part = resolveMessageFile(file, "/repo/worktree")!

    expect(part).toBeDefined()
    expect(fileURLToPath(part.url)).toBe("/repo/worktree/..config")

    const relative = parseMessageFiles([{ mime: "text/plain", path: "..config" }])![0]!
    const relativePart = resolveMessageFile(relative, "/repo/worktree")!
    expect(relativePart).toBeDefined()
    expect(fileURLToPath(relativePart.url)).toBe("/repo/worktree/..config")
  })

  it("keeps a relative path with ../ segments that still resolves inside the session directory", () => {
    const file = parseMessageFiles([{ mime: "text/plain", path: "sub/../README.md" }])![0]!
    const part = resolveMessageFile(file, "/repo/worktree")!

    expect(part).toBeDefined()
    expect(fileURLToPath(part.url)).toBe("/repo/worktree/README.md")
  })

  it("does not apply containment checks to url-form attachments", () => {
    // file:// URL 由 webview 端生成时完成归属检查；data:/session: 无路径语义。
    const file = parseMessageFiles([{ mime: "text/plain", url: "session:ses_x" }])![0]!
    const part = resolveMessageFile(file, "/repo/worktree")!

    expect(part.url).toBe("session:ses_x")
  })

  it("accepts past-chat session attachments", () => {
    const files = parseMessageFiles([
      {
        mime: "text/plain",
        url: "session:ses_07c08a2ddffeXample",
        filename: "fix-auth-bug.md",
        source: {
          type: "file",
          path: "session:ses_07c08a2ddffeXample",
          text: { value: "@Fix auth bug", start: 0, end: 13 },
        },
      },
    ])

    expect(files?.[0]?.url).toBe("session:ses_07c08a2ddffeXample")
    expect(files?.[0]?.filename).toBe("fix-auth-bug.md")
  })
})
