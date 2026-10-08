import { afterEach, expect } from "bun:test"
import { Server } from "../../../src/server/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"
import { it } from "../../lib/effect"
import { Effect } from "effect"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

it.live(
  "快速供应商接口通过真实路由传递失败列表",
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireRelease(
      Effect.promise(() => tmpdir({ config: { enabled_providers: [], formatter: false, lsp: false } })),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    )
    const response = yield* Effect.promise(() =>
      Promise.resolve(Server.Default().app.request("/config/providers", { headers: { "x-kilo-directory": tmp.path } })),
    )
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toMatchObject({ providers: [], default: {}, failed: [] })
  }),
)
