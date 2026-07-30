import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import { KiloShutdown } from "@/kilocode/cli/shutdown" // kilocode_change

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless kilo server",
  // Server loads instances per-request via x-kilo-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false, // kilocode_change
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.KILO_SERVER_PASSWORD) {
      console.log("Warning: KILO_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))

    // kilocode_change start
    const urls = server.urls

    console.log(`kilo server listening on ${urls.bind}`)
    if (urls.local !== urls.bind) console.log(`  Local:   ${urls.local}`)
    if (urls.network) console.log(`  Network: ${urls.network}`)
    // kilocode_change end

    // kilocode_change start - graceful signal shutdown
    // yield* Effect.never
    // 孤儿检测已统一收敛到 KiloShutdown.waitForServer 内部（复用 parent-watchdog，
    // 仅在设置 KILO_PARENT_PID 时生效），此处不再单独启动 watchdog，避免双重停机竞争。
    // 上游 v7.4.17 在停机序列中新增的 KiloSessions.drainIngestForShutdown()
    // 已随本次合并移植到 KiloShutdown.waitForServer 内部执行。
    yield* Effect.promise(() => KiloShutdown.waitForServer(server))
    // kilocode_change end
  }),
})
