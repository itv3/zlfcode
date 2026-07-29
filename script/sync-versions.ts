#!/usr/bin/env bun
// kilocode_change - new file
// Sync every Kilo version string across the monorepo to a single target.
//
// Why this exists: upstream stamps its own version into the `package.json`
// files it bumped during each release. When we merge upstream, that churn
// either produces conflicts or silently leaves our packages pointing at
// upstream's version string.
//（F63 说明：历史版本的本注释还提到 zed extension.toml 的下载地址 404 问题并
// 因此改写该文件——那与下方"Intentionally NOT touched"的现行结论方向相反，
// 已随 F56 修复一并纠正：该文件必须保持 Kilo-Org 上游底座版本，本脚本不再触碰。）
//
// Run this in a dedicated commit after resolving an upstream merge (see
// `.kilo/command/upstream-manual-merge.md`). It's also handy mid-merge to
// rebase our version bumps onto any new Kilo main releases.
//
// Usage:
//   bun run script/sync-versions.ts            # use root package.json version
//   bun run script/sync-versions.ts 7.2.41     # explicit target
//   bun run script/sync-versions.ts v7.2.41    # leading `v` is stripped
//
// What gets updated:
//   - every `package.json` top-level `"version": "..."` field in the repo
//     (excluding node_modules and hidden directories)
//
// Intentionally NOT touched:
//   - `packages/kilo-jetbrains/**` — the JetBrains plugin has its own release
//     cadence and version number.
//   - dependency version strings inside `package.json` — internal deps use
//     `workspace:*` so they don't need bumping.
//   - `packages/extensions/zed/extension.toml` — 该文件的 version 与五个
//     archive URL 指向 Kilo-Org 上游 release（如 v7.4.16）。ZLF 不发布 Zed
//     扩展，如果把它们改写为 ZLF 市场版本（如 7.4.1603），会生成上游不存在
//     的 release 下载地址（全部 404）。因此保持上游底座版本原值不做批次替换。

import { Glob } from "bun"
import { join } from "node:path"

const root = join(import.meta.dir, "..")

const arg = process.argv[2]
const target = await (async () => {
  if (arg) return arg.replace(/^v/, "")
  const pkg = await Bun.file(join(root, "package.json")).json()
  return pkg.version as string
})()

if (!/^\d+\.\d+\.\d+([-+].+)?$/.test(target)) {
  console.error(`error: invalid version "${target}"`)
  process.exit(1)
}

console.log(`syncing versions → ${target}\n`)

let updated = 0

const glob = new Glob("**/package.json")
for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
  if (rel.includes("node_modules/")) continue
  if (rel.startsWith(".")) continue
  if (rel.includes("/.")) continue
  // JetBrains plugin tracks its own version.
  if (rel.startsWith("packages/kilo-jetbrains/")) continue

  const path = join(root, rel)
  const text = await Bun.file(path).text()

  // Only rewrite the top-level version field — avoid touching nested
  // dependency version fields or versions inside sub-strings. The first
  // `"version"` key at 2-space indentation is always the package version in
  // this repo's style.
  const next = text.replace(/^(\s*)"version":\s*"[^"]+"(,?)/m, (_m, indent, comma) => {
    return `${indent}"version": "${target}"${comma}`
  })

  if (next === text) continue
  // Defensive: the replace above runs unconditionally on any match — skip if
  // the file had no `"version"` key at all.
  if (!/"version"\s*:/.test(text)) continue

  await Bun.write(path, next)
  console.log(`  ${rel}`)
  updated++
}

// 注意：`packages/extensions/zed/extension.toml` 被有意排除在同步范围之外。
// 其 version 与 archive URL 必须保持上游底座版本（指向 Kilo-Org 的真实 release），
// 改写为 ZLF 市场版本会得到不存在的下载地址。见文件头注释。

console.log(`\nupdated ${updated} file(s)`)
