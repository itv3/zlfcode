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
  await mkdir(join(root, "packages/app/dist/generated"), { recursive: true })
  await Bun.write(join(root, "packages/app/dist/generated/package.json"), JSON.stringify({ version: "0.0.0-dev" }))
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

test("Zed 扩展 archive URL 版本被单独改坏时校验失败（F71）", async () => {
  const root = await fixture()
  // version 行正确、但某个 archive URL 的版本段被改坏（如合并冲突解决失误）。
  await Bun.write(
    join(root, "packages/extensions/zed/extension.toml"),
    [
      'version = "7.4.5"',
      'archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.4.5/opencode-darwin-arm64.zip"',
      'archive = "https://github.com/Kilo-Org/kilocode/releases/download/v7.4.507/opencode-linux-x64.tar.gz"',
    ].join("\n"),
  )

  const result = await validate(root, "zlfcode-v7.4.5-v0.07")
  expect(result.errors).toContain(
    "packages/extensions/zed/extension.toml 的 archive URL 版本是 v7.4.507，期望上游底座版本 v7.4.5",
  )
  // 版本正确的 URL 不应误报。
  expect(result.errors.filter((error) => error.includes("archive URL"))).toHaveLength(1)
})

test("Zed 扩展被误写成市场版本时校验失败", async () => {
  const root = await fixture()
  // 模拟 sync-versions 误把 extension.toml 改写成 ZLF 市场版本的场景。
  await Bun.write(join(root, "packages/extensions/zed/extension.toml"), 'version = "7.4.507"')

  const result = await validate(root, "zlfcode-v7.4.5-v0.07")
  expect(result.errors).toContain('packages/extensions/zed/extension.toml 缺少当前发布信息：version = "7.4.5"')
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
  // Zed 扩展保持上游底座版本（7.4.5），不随 ZLF 批次改写为市场版本（7.4.507）。
  await Bun.write(join(root, "packages/extensions/zed/extension.toml"), 'version = "7.4.5"')
  await Bun.write(join(root, ".github/release-notes/zlfcode-v7.4.5-v0.07.md"), "# ZLF Code 7.4.5-v0.07")
  return root
}
