import { describe, expect, it } from "bun:test"

import type { Provider } from "../../webview-ui/src/types/messages"
import {
  isPopularProvider,
  popularProviderIndex,
  providerNoteKey,
  sortProviders,
} from "../../webview-ui/src/components/settings/provider-catalog"

function provider(id: string, metadata?: Provider["metadata"]): Provider {
  return {
    id,
    name: id,
    models: {},
    metadata,
  }
}

describe("provider catalog", () => {
  it("treats known provider objects as popular when metadata is unavailable", () => {
    expect(isPopularProvider(provider("openai"))).toBe(true)
    expect(isPopularProvider(provider("anthropic"))).toBe(true)
    expect(isPopularProvider(provider("unknown"))).toBe(false)
  })

  it("uses fallback ordering for provider objects without metadata", () => {
    const items = [provider("openai"), provider("anthropic"), provider("unknown")]
    const ids = sortProviders(items).map((item) => item.id)

    expect(ids).toEqual(["anthropic", "openai", "unknown"])
  })

  it("prefers metadata priority over fallback ordering", () => {
    expect(popularProviderIndex(provider("openai", { priority: 1 }))).toBe(1)
  })

  // providerNoteKey 是上游导出符号的兼容壳（README 维护原则第 5 条），
  // 此处锁定其与上游 v7.4.16 一致的行为，防止未来被误删或改义。
  describe("providerNoteKey（上游兼容壳）", () => {
    it("优先返回 provider metadata 中的 noteKey", () => {
      expect(providerNoteKey(provider("openai", { noteKey: "settings.providers.note.custom" }))).toBe(
        "settings.providers.note.custom",
      )
    })

    it("字符串形式的 kilo provider ID 返回内置 note key", () => {
      expect(providerNoteKey("kilo")).toBe("settings.providers.note.kilo")
    })

    it("无 noteKey 的普通 provider 返回 undefined", () => {
      expect(providerNoteKey(provider("openai"))).toBeUndefined()
      expect(providerNoteKey("openai")).toBeUndefined()
    })
  })
})
