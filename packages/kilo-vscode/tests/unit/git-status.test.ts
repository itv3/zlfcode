import { describe, expect, it } from "bun:test"
import { hasGit } from "../../src/kilo-provider/git-status"

describe("hasGit", () => {
  it("returns false when the client is missing", async () => {
    await expect(hasGit(null, "/repo")).resolves.toBe(false)
  })

  it("returns true when the project endpoint reports git", async () => {
    const client = {
      project: {
        current: async () => ({ data: { vcs: "git" } }),
      },
    }

    await expect(hasGit(client as never, "/repo")).resolves.toBe(true)
  })
})
