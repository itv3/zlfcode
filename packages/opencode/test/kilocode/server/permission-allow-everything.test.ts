// ⚠️ 已知测试隔离限制（F69，预存缺陷，保守处理）：本文件的 HTTP 用例与
// test/kilocode/server/ 目录整体连跑（bun test test/kilocode/server/）时会互相干扰：
//
// 根因链（2026-07-30 排查确认）：
// 1. Server.Default() 与 HttpApiApp.webHandler 是进程级 lazy 单例，认证配置
//    （ServerAuth.Config.defaultLayer 读 KILO_SERVER_PASSWORD）在单例首次构建时
//    解析一次并被共享 memoMap（@opencode-ai/core/effect/memo-map）memo；
// 2. lazy.reset() 无法绕开——重建的 handler 经同一 memoMap 拿回旧 auth config
//    （已用探针实证：reset 后重设密码再请求仍 401）；
// 3. /permission/allow-everything 属 REQUIRED_AUTH_PATHS（fail-closed）：单例在
//    无密码状态下构建后，该端点无论携带什么凭据一律 401；反之本文件先跑并以
//    requireAuth() 的密码构建单例后，后续文件（cloud-session-import 等）的无凭据
//    请求会全部 401。三组测试对同一单例的认证状态期望互斥，同进程连跑必有一方失败。
//
// 影响范围：仅本地整目录连跑；CI 经 script/test-runner.ts 按文件 shard 分进程执行，
// 不受影响。单独运行本文件（bun test test/kilocode/server/permission-allow-everything.test.ts）
// 语义完整且通过。
//
// 彻底修复方向（另立任务）：为测试提供非单例的 webHandler 工厂（独立 memoMap）并
// 适配 fixture 实例路由，或引入按文件的进程隔离运行方式。在此之前请勿以"整目录
// 连跑出现 401"作为回归判断依据。
import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../../src/bus"
import * as Config from "../../../src/config/config"
import { AllowEverythingPermission } from "../../../src/kilocode/permission/allow-everything"
import { Permission } from "../../../src/permission"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Database } from "@opencode-ai/core/database/database"
import { provideTestInstance } from "../../fixture/fixture"
import { Server } from "../../../src/server/server"
import { Session } from "../../../src/session/session"
import { provideTmpdirInstance, tmpdir } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const bus = Bus.layer
const env = Layer.mergeAll(
  Permission.layer.pipe(
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Database.defaultLayer),
  ),
  Config.defaultLayer,
  Session.defaultLayer,
  bus,
  CrossSpawnSpawner.defaultLayer,
)
const it = testEffect(env)
const original = {
  password: Flag.KILO_SERVER_PASSWORD,
  username: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
}

afterEach(() => {
  Flag.KILO_SERVER_PASSWORD = original.password
  Flag.KILO_SERVER_USERNAME = original.username
  if (original.envPassword === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.KILO_SERVER_USERNAME
  else process.env.KILO_SERVER_USERNAME = original.envUsername
})

const auth = () => `Basic ${Buffer.from("kilo:secret").toString("base64")}`

const requireAuth = () => {
  Flag.KILO_SERVER_PASSWORD = "secret"
  Flag.KILO_SERVER_USERNAME = undefined
  process.env.KILO_SERVER_PASSWORD = "secret"
  delete process.env.KILO_SERVER_USERNAME
}

const ask = (input: Permission.AskInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Permission.ReplyInput) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const wait = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    for (let i = 0; i < 100; i++) {
      if ((yield* permission.list()).length > 0) return
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error("timed out waiting for pending permission request"))
  })

describe("AllowEverythingPermission", () => {
  test("handles disable requests through the HTTP endpoint", async () => {
    requireAuth()
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const blocked = await Server.Default().app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path },
          body: JSON.stringify({ enable: true }),
        })
        expect(blocked.status).toBe(401)

        const enable = await Server.Default().app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path, authorization: auth() },
          body: JSON.stringify({ enable: true }),
        })
        expect(enable.status).toBe(200)

        const disable = await Server.Default().app.request("/permission/allow-everything", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-kilo-directory": tmp.path, authorization: auth() },
          body: JSON.stringify({ enable: false }),
        })
        expect(disable.status).toBe(200)
        expect(await disable.json()).toBe(true)
      },
    })
  })

  it.live("disables global allow-all and restores permission prompts", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          expect(yield* AllowEverythingPermission.effect({ enable: true })).toBe(true)
          expect(yield* AllowEverythingPermission.effect({ enable: false })).toBe(true)

          const session = yield* sessions.create({})
          const pending = yield* ask({
            id: PermissionV1.ID.make("permission_global_disable"),
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionV1.ID.make("permission_global_disable"),
            reply: "reject",
          })

          const exit = yield* Fiber.await(pending)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
          }
        }),
      { git: true },
    ),
  )

  it.live("disables session-scoped allow-all without affecting other sessions", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const session = yield* sessions.create({
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          expect(yield* AllowEverythingPermission.effect({ enable: true, sessionID: session.id })).toBe(true)
          expect(yield* AllowEverythingPermission.effect({ enable: false, sessionID: session.id })).toBe(true)

          const next = yield* sessions.get(session.id)
          expect(next.permission ?? []).toEqual([])

          const pending = yield* ask({
            id: PermissionV1.ID.make("permission_session_disable"),
            sessionID: session.id,
            permission: "bash",
            patterns: ["ls"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionV1.ID.make("permission_session_disable"),
            reply: "reject",
          })

          const exit = yield* Fiber.await(pending)
          expect(Exit.isFailure(exit)).toBe(true)
          if (Exit.isFailure(exit)) {
            expect(Cause.squash(exit.cause)).toBeInstanceOf(Permission.RejectedError)
          }

          const other = yield* sessions.create({})
          const blocked = yield* ask({
            id: PermissionV1.ID.make("permission_other_session"),
            sessionID: other.id,
            permission: "bash",
            patterns: ["pwd"],
            metadata: {},
            always: [],
            ruleset: [],
          }).pipe(Effect.forkScoped)

          yield* wait()
          yield* reply({
            requestID: PermissionV1.ID.make("permission_other_session"),
            reply: "reject",
          })

          const blockedExit = yield* Fiber.await(blocked)
          expect(Exit.isFailure(blockedExit)).toBe(true)
          if (Exit.isFailure(blockedExit)) {
            expect(Cause.squash(blockedExit.cause)).toBeInstanceOf(Permission.RejectedError)
          }
        }),
      { git: true },
    ),
  )
})
