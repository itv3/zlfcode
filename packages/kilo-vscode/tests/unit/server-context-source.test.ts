import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

/**
 * server.tsx 相对上游 v7.4.16 只允许保留一个最小行为补丁：
 * connectionState 消息的 state 离开 connected 时清空 serverInfo。
 *
 * 本测试是该补丁的存在性守卫——文件其余部分刻意保持与上游 switch
 * 结构逐语句一致（最小补丁维护原则），后续三方合并上游 tag 时该行
 * 最容易被误丢，这里锁定它必须存在于 connectionState case 内且带
 * kilocode_change 标记。
 */
const file = path.resolve(import.meta.dir, "../../webview-ui/src/context/server.tsx")
const source = fs.readFileSync(file, "utf8")

describe("server context 最小补丁守卫", () => {
  it("connectionState 非 connected 时必须清空 serverInfo（kilocode_change 补丁）", () => {
    const idx = source.indexOf('case "connectionState":')
    expect(idx, "上游 connectionState case 必须存在").toBeGreaterThan(-1)
    const snippet = source.slice(idx, idx + 700)
    expect(snippet).toContain('if (message.state !== "connected") setServerInfo(undefined)')
    expect(snippet).toContain("kilocode_change")
  })

  it("补丁必须先清空 serverInfo 再处理 error 分支（与既有行为一致）", () => {
    const idx = source.indexOf('if (message.state !== "connected") setServerInfo(undefined)')
    expect(idx).toBeGreaterThan(-1)
    const errorIdx = source.indexOf("if (message.error) {", idx)
    expect(errorIdx, "error 分支必须在补丁之后").toBeGreaterThan(idx)
  })
})
