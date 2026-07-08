import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as path from "path"

const root = path.join(__dirname, "../..")

function src(file: string) {
  return fs.readFileSync(path.join(root, file), "utf-8")
}

describe("ProvidersTab source", () => {
  it("keeps popular providers out of the main settings page", () => {
    const tab = src("webview-ui/src/components/settings/ProvidersTab.tsx")
    const dialog = src("webview-ui/src/components/settings/ProviderSelectDialog.tsx")

    expect(tab).not.toContain("settings.providers.section.popular")
    expect(tab).not.toContain("popularProviders")
    expect(tab).toContain("ProviderSelectDialog")
    expect(tab).toContain("CustomProviderDialog")
    expect(dialog).toContain("popularProviderIndex")
    expect(dialog).toContain("settings.providers.group.recommended")
  })
})
