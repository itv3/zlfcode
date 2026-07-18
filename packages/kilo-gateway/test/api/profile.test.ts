import { afterEach, describe, expect, test } from "bun:test"
import { defaultOrganizationId, fetchDefaultModel } from "../../src/api/profile.js"
import { DEFAULT_FREE_MODEL, DEFAULT_MODEL } from "../../src/api/constants.js"
import type { KilocodeProfile } from "../../src/types.js"

const fetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = fetch
})

const profile = (input: Partial<KilocodeProfile> = {}): KilocodeProfile => ({
  email: "user@example.com",
  organizations: [{ id: "org_1", name: "Acme", role: "MEMBER" }],
  ...input,
})

describe("defaultOrganizationId", () => {
  test("defaults to the cloud selected organization", () => {
    expect(defaultOrganizationId(profile({ selectedOrganizationId: "org_1" }))).toBe("org_1")
  })

  test("defaults to personal when there is no cloud selection", () => {
    expect(defaultOrganizationId(profile())).toBeUndefined()
  })

  test("ignores a cloud selection that is not one of the user's organizations", () => {
    expect(defaultOrganizationId(profile({ selectedOrganizationId: "missing" }))).toBeUndefined()
  })

  test("falls back to the first organization when there is no personal account", () => {
    expect(
      defaultOrganizationId(
        profile({
          hasPersonalAccount: false,
          organizations: [
            { id: "org_1", name: "Acme", role: "MEMBER" },
            { id: "org_2", name: "Beta", role: "MEMBER" },
          ],
        }),
      ),
    ).toBe("org_1")
  })

  test("prefers a valid cloud selection over the first-organization fallback", () => {
    expect(
      defaultOrganizationId(
        profile({
          selectedOrganizationId: "org_2",
          hasPersonalAccount: false,
          organizations: [
            { id: "org_1", name: "Acme", role: "MEMBER" },
            { id: "org_2", name: "Beta", role: "MEMBER" },
          ],
        }),
      ),
    ).toBe("org_2")
  })
})

describe("fetchDefaultModel", () => {
  test("creates a default timeout signal", async () => {
    globalThis.fetch = (_input, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Promise.reject(new Error("模拟网络失败"))
    }

    expect(await fetchDefaultModel()).toBe(DEFAULT_FREE_MODEL)
  })

  test("uses the anonymous fallback when the request times out", async () => {
    globalThis.fetch = (_input, init) => {
      const signal = init?.signal
      if (!signal) return Promise.reject(new Error("缺少超时信号"))
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    }

    const model = await fetchDefaultModel(undefined, undefined, AbortSignal.timeout(5))

    expect(model).toBe(DEFAULT_FREE_MODEL)
  })

  test("uses the authenticated fallback when the request is aborted", async () => {
    globalThis.fetch = (_input, init) => {
      expect(init?.signal?.aborted).toBe(true)
      return Promise.reject(init?.signal?.reason)
    }

    const model = await fetchDefaultModel("test-token", undefined, AbortSignal.abort())

    expect(model).toBe(DEFAULT_MODEL)
  })
})
