import { expect, it } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { fetchProviderData } from "../../src/provider-actions"

it("通过真实 SDK 请求保留快速快照和完整目录的供应商错误原因", async () => {
  const failures = [{ providerID: "kilo", kind: "unauthorized", status: 401 }]
  const paths: string[] = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      paths.push(path)
      if (path === "/config/providers") {
        return Response.json({ providers: [], default: {}, failed: ["kilo"], failures })
      }
      if (path === "/provider") {
        return Response.json({ all: [], connected: [], default: {}, failed: ["kilo"], failures })
      }
      if (path === "/kilo/auth-status") {
        return Response.json({ authenticated: true, type: "oauth", organizationId: "org_test" })
      }
      return Response.json({})
    },
  })
  const client = createKiloClient({ baseUrl: server.url.origin })
  for (const mode of ["connected", "catalog"] as const) {
    const result = await fetchProviderData(client, "/workspace", mode)
    expect(result.response.failures).toEqual(failures)
    expect(result.unavailable).toBe(true)
  }
  expect(paths).toContain("/config/providers")
  expect(paths).toContain("/provider")
})
