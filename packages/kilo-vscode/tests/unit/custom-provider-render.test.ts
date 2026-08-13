// kilocode_change - new file
// 自定义提供商界面的渲染回归测试（ZLF）。
//
// 背景：v7.4.21 合并后曾出现两类仅在真实渲染时暴露的回归——「默认推理强度」
// 选择器被误删、编辑对话框因 Dialog fit 模式失去高度上限而无法滚动。这些逻辑
// 测试覆盖不到，故用 happy-dom 完整渲染 ModelCard 与编辑态 CustomProviderDialog
// 做冒烟：fixture 渲染失败（崩溃 / 关键控件缺失）即退出非零。
import { describe, expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const ROOT = path.resolve(import.meta.dir, "../..")
const WEBVIEW = path.join(ROOT, "webview-ui")
const STUBS = path.join(ROOT, "tests/fixtures/stubs")

async function runFixture(fixture: string, opts: { stubContexts?: boolean } = {}) {
  const solid = path.dirname(Bun.resolveSync("solid-js/package.json", WEBVIEW))
  const aliases: Record<string, string> = {
    "solid-js": path.join(solid, "dist/solid.js"),
    "solid-js/web": path.join(solid, "web/dist/web.js"),
    "solid-js/store": path.join(solid, "store/dist/store.js"),
  }
  const dedupe = {
    name: "solid-dedupe-and-stubs",
    setup(ctx: Parameters<NonNullable<Parameters<typeof build>[0]["plugins"]>[number]["setup"]>[0]) {
      ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
      if (opts.stubContexts) {
        // Dialog 依赖的 context 与外层 kobalte Dialog 容器以 stub 注入，
        // 只验证 CustomProviderDialog 自身的编辑态渲染。
        ctx.onResolve({ filter: /context\/(vscode|config|provider|language)$/ }, (args) => ({
          path: path.join(STUBS, `${args.path.split("/").pop()}.tsx`),
        }))
        ctx.onResolve({ filter: /kilo-ui\/context\/dialog$/ }, () => ({ path: path.join(STUBS, "dialog.tsx") }))
        ctx.onResolve({ filter: /kilo-ui\/dialog$/ }, () => ({ path: path.join(STUBS, "kilo-dialog.tsx") }))
      }
    },
  }
  const result = await build({
    entryPoints: [path.join(ROOT, "tests/fixtures", fixture)],
    bundle: true,
    conditions: ["browser"],
    external: ["happy-dom"],
    format: "esm",
    logLevel: "silent",
    platform: "node",
    loader: { ".svg": "dataurl", ".css": "empty", ".woff2": "empty" },
    plugins: [dedupe, solidPlugin()],
    target: "es2022",
    write: false,
  })
  const file = path.join(ROOT, `.${fixture.replace(/\.tsx$/, "")}-${crypto.randomUUID()}.mjs`)
  await Bun.write(file, result.outputFiles[0]!.contents)
  const child = Bun.spawnSync(["bun", file], { cwd: WEBVIEW, stdout: "pipe", stderr: "pipe" })
  unlinkSync(file)
  return child
}

describe("custom provider rendering", () => {
  it(
    "renders the model card with the default reasoning effort picker",
    async () => {
      const child = await runFixture("model-card-default-variant.tsx")
      const output = child.stdout.toString() + child.stderr.toString()
      expect(child.exitCode, output).toBe(0)
      expect(output).toContain("MODEL_CARD_RENDER_OK")
    },
    30_000,
  )

  it(
    "renders existing models when the dialog opens in edit mode",
    async () => {
      const child = await runFixture("custom-provider-dialog-edit.tsx", { stubContexts: true })
      const output = child.stdout.toString() + child.stderr.toString()
      expect(child.exitCode, output).toBe(0)
      expect(output).toContain("DIALOG_EDIT_RENDER_OK")
    },
    30_000,
  )
})
