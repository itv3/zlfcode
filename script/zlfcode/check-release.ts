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
  }
}

export async function validate(root: string, tag: string) {
  const meta = parse(tag)
  const errors: string[] = []
  const glob = new Glob("**/package.json")

  for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
    if (rel.includes("node_modules/")) continue
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
  await contains(root, "packages/extensions/zed/extension.toml", `version = "${meta.version}"`, errors)

  const notes = `.github/release-notes/${tag}.md`
  if (!(await Bun.file(join(root, notes)).exists())) errors.push(`缺少发布说明：${notes}`)

  return { ...meta, errors }
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
