import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import * as ModelsRefresh from "../../src/kilocode/models-refresh"

describe("ModelsRefresh", () => {
  it("有序失效所有监听器并在单个监听器失败后继续", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const calls: string[] = []
          yield* ModelsRefresh.watch(() => Effect.sync(() => calls.push("first")))
          yield* ModelsRefresh.watch(() => Effect.die("refresh failed"))
          yield* ModelsRefresh.watch(() => Effect.sync(() => calls.push("last")))

          yield* ModelsRefresh.notify()
          expect(calls).toEqual(["first", "last"])
        }),
      ),
    )
  })
})
