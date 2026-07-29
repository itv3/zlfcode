// kilocode_change - new file
import { Glob } from "bun"
import { join } from "node:path"

const pattern = /^zlfcode-v(\d+)\.(\d+)\.(\d+)-v0\.(\d{2})$/

export function parse(tag: string) {
  const match = tag.match(pattern)
  if (!match) throw new Error(`发布标签格式错误：${tag}`)

  const major = match[1]!
  const minor = match[2]!
  const patch = match[3]!
  const batch = match[4]!
  return {
    tag,
    label: tag.slice("zlfcode-v".length),
    version: `${major}.${minor}.${Number(`${patch}${batch}`)}`,
    // 上游底座版本（如 7.4.16）。Zed 扩展的 extension.toml 必须保持该版本，
    // 因为其中的 archive URL 指向 Kilo-Org 上游 release，写入 ZLF 市场版本会 404。
    base: `${major}.${minor}.${patch}`,
  }
}

export async function validate(root: string, tag: string) {
  const meta = parse(tag)
  const errors: string[] = []
  const glob = new Glob("**/package.json")

  for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
    if (rel.includes("node_modules/")) continue
    if (rel.startsWith("dist/") || rel.includes("/dist/")) continue
    if (rel.startsWith(".") || rel.includes("/.")) continue
    if (rel.startsWith("packages/kilo-jetbrains/")) continue

    const pkg = await Bun.file(join(root, rel)).json()
    if (!pkg.version || pkg.version === meta.version) continue
    errors.push(`${rel} 的版本是 ${pkg.version}，期望 ${meta.version}`)
  }

  await contains(root, "README.md", `| 发布批次 | \`${meta.label}\` |`, errors)
  await contains(root, "README.md", `| 市场版本 | \`${meta.version}\` |`, errors)
  await contains(root, "packages/kilo-vscode/README.md", `发布批次：\`${meta.label}\``, errors)
  await contains(root, "packages/kilo-vscode/README.md", `市场版本：\`${meta.version}\``, errors)
  // Zed 扩展保持上游底座版本：sync-versions.ts 已把它排除在批次替换之外，
  // 这里校验它没有被误写成市场版本，防止 archive URL 指向不存在的 release。
  await contains(root, "packages/extensions/zed/extension.toml", `version = "${meta.base}"`, errors)
  // F71：version 行之外，5 个 archive URL 的版本段也可能被单独改坏（如合并冲突
  // 解决失误）。校验文件内出现的每个 `releases/download/vX/` 下载 URL（不限域名，
  // fail-closed：当前只有 Kilo-Org 地址，未来引入其他来源时按需放宽）的版本都
  // 等于底座版本；文件缺失已由上一行 contains 报告，URL 为零个时不误报。
  await zedArchiveURLs(root, meta.base, errors)

  const notes = `.github/release-notes/${tag}.md`
  if (!(await Bun.file(join(root, notes)).exists())) errors.push(`缺少发布说明：${notes}`)

  return { ...meta, errors }
}

async function zedArchiveURLs(root: string, base: string, errors: string[]) {
  const rel = "packages/extensions/zed/extension.toml"
  const file = Bun.file(join(root, rel))
  if (!(await file.exists())) return // 文件缺失由 version 行的 contains 校验统一报告
  const text = await file.text()
  for (const match of text.matchAll(/releases\/download\/v([^/]+)\//g)) {
    const found = match[1]!
    if (found === base) continue
    errors.push(`${rel} 的 archive URL 版本是 v${found}，期望上游底座版本 v${base}`)
  }
}

async function contains(root: string, rel: string, expected: string, errors: string[]) {
  const file = Bun.file(join(root, rel))
  if (!(await file.exists())) {
    errors.push(`缺少文件：${rel}`)
    return
  }
  if ((await file.text()).includes(expected)) return
  errors.push(`${rel} 缺少当前发布信息：${expected}`)
}

if (import.meta.main) {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? ""
  const root = join(import.meta.dir, "../..")
  const result = await validate(root, tag)
  if (result.errors.length) {
    console.error(`ZLF 发布校验失败（${result.tag} → ${result.version}）：`)
    for (const error of result.errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log(`ZLF 发布校验通过：${result.tag} → ${result.version}`)
}
