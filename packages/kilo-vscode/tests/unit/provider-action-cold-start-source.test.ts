import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(__dirname, "..", "..")
const file = join(root, "src", "KiloProvider.ts")

describe("KiloProvider provider action cold start", () => {
  it("uses the minimal shared client connection before full webview initialization", () => {
    const source = readFileSync(file, "utf8")
    const start = source.indexOf("private async handleProviderAction")
    const end = source.indexOf("private favoritesSeeded", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)

    const body = source.slice(start, end)
    expect(body).toContain("this.connectionService.getClientAsync(this.getWorkspaceDirectory())")
    expect(body).toContain("void this.initializeConnection().catch")
    expect(body).not.toContain("await this.initializeConnection()")
  })

  it("reconnects when the cached client exists but the shared connection is not connected", () => {
    const source = readFileSync(file, "utf8")
    const start = source.indexOf("private async handleProviderAction")
    const end = source.indexOf("private favoritesSeeded", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)

    const body = source.slice(start, end)
    expect(body).toContain("const state = this.connectionService.getConnectionState()")
    expect(body).toContain('if (!client || state !== "connected")')
    expect(body).toContain("client = await this.connectionService.getClientAsync(this.getWorkspaceDirectory())")
  })

  it("syncs state after full connection initialization", () => {
    const source = readFileSync(file, "utf8")
    const start = source.indexOf("private async doInitializeConnection")
    const end = source.indexOf("// Subscribe to SSE events", start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)

    const body = source.slice(start, end)
    expect(body).toContain("await this.connectionService.connect(workspaceDir)")
    expect(body).toContain("this.connectionState = this.connectionService.getConnectionState()")
  })
})
