import { describe, expect, it } from "bun:test"
import { handleFileSearch } from "../../src/kilo-provider/file-search"

describe("handleFileSearch", () => {
  it("returns the resolved directory when the backend client is unavailable", async () => {
    const posted: unknown[] = []

    await handleFileSearch({
      client: null,
      message: { query: "README.md", requestId: "file-search-1", sessionID: "s1" },
      dir: (id) => (id === "s1" ? "/repo/worktree" : "/repo"),
      open: async () => new Set<string>(),
      post: (msg) => posted.push(msg),
    })

    expect(posted).toEqual([
      {
        type: "fileSearchResult",
        paths: [],
        items: [],
        dir: "/repo/worktree",
        requestId: "file-search-1",
      },
    ])
  })
})
