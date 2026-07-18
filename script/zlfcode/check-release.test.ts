// kilocode_change - new file
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { parse, validate } from "./check-release"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("发布批次严格映射为市场版本", () => {
  expect(parse("zlfcode-v7.4.5-v0.07").version).toBe("7.4.507")
  expect(parse("zlfcode-v7.4.5-v0.10").version).toBe("7.4.510")
  expect(() => parse("zlfcode-v7.4.5-v0.7")).toThrow("发布标签格式错误")
})

test("一致的实际发布文件通过校验", async () => {
  const root = await fixture()
  const result = await validate(root, "zlfcode-v7.4.5-v0.07")
  expect(result.errors).toEqual([])
})

test("版本、说明和文档不一致时列出全部错误", async () => {
  const root = await fixture()
  await Bun.write(join(root, "packages/app/package.json"), JSON.stringify({ version: "7.4.506" }))
  await rm(join(root, ".github/release-notes/zlfcode-v7.4.5-v0.07.md"))
  await Bun.write(join(root, "README.md"), "| 发布批次 | `7.4.5-v0.06` |\n| 市场版本 | `7.4.506` |")

  const result = await validate(root, "zlfcode-v7.4.5-v0.07")
  expect(result.errors).toContain("packages/app/package.json 的版本是 7.4.506，期望 7.4.507")
  expect(result.errors).toContain("缺少发布说明：.github/release-notes/zlfcode-v7.4.5-v0.07.md")
  expect(result.errors.some((error) => error.startsWith("README.md 缺少当前发布信息"))).toBe(true)
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "zlfcode-release-"))
  roots.push(root)
  const dirs = ["packages/app", "packages/kilo-vscode", "packages/extensions/zed", ".github/release-notes"]
  await Promise.all(dirs.map((dir) => mkdir(join(root, dir), { recursive: true })))
  await Bun.write(join(root, "package.json"), JSON.stringify({ version: "7.4.507" }))
  await Bun.write(join(root, "packages/app/package.json"), JSON.stringify({ version: "7.4.507" }))
  await Bun.write(join(root, "packages/kilo-vscode/package.json"), JSON.stringify({ version: "7.4.507" }))
  await Bun.write(join(root, "README.md"), "| 发布批次 | `7.4.5-v0.07` |\n| 市场版本 | `7.4.507` |")
  await Bun.write(join(root, "packages/kilo-vscode/README.md"), "发布批次：`7.4.5-v0.07`\n市场版本：`7.4.507`")
  await Bun.write(join(root, "packages/extensions/zed/extension.toml"), 'version = "7.4.507"')
  await Bun.write(join(root, ".github/release-notes/zlfcode-v7.4.5-v0.07.md"), "# ZLF Code 7.4.5-v0.07")
  return root
}
