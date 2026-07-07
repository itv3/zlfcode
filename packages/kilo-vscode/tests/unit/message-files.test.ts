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
    const part = resolveMessageFile(file, "/repo/worktree")

    expect(fileURLToPath(part.url)).toBe("/repo/worktree/README.md")
    expect(part.filename).toBeUndefined()
  })
})
