import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const file = path.resolve(import.meta.dir, "../../src/KiloProvider.ts")
const source = fs.readFileSync(file, "utf8")

describe("KiloProvider reconnect refresh wiring", () => {
  it("refreshes connection data after SSE reconnects", () => {
    const idx = source.indexOf('state === "connected"')
    expect(idx, '"connected" state handler must exist').toBeGreaterThan(-1)
    const snippet = source.slice(idx, idx + 1200)
    expect(snippet).toContain("this.refreshConnectionData()")
  })

  it("refreshes connection data during initializeConnection", () => {
    const idx = source.indexOf('this.syncWebviewState("initializeConnection")')
    expect(idx, "initializeConnection sync call must exist").toBeGreaterThan(-1)
    const snippet = source.slice(idx, idx + 300)
    expect(snippet).toContain("this.refreshConnectionData()")
  })
})
