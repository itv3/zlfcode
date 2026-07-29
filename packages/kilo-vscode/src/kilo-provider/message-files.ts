import { z } from "zod"
import * as path from "path"
import { pathToFileURL } from "url"

const source = z.object({
  type: z.literal("file"),
  path: z.string(),
  text: z.object({
    value: z.string(),
    start: z.number(),
    end: z.number(),
  }),
})

const file = z
  .object({
    mime: z.string(),
    url: z.string().optional(),
    path: z.string().min(1).optional(),
    filename: z.string().optional(),
    source: source.optional(),
  })
  .refine(
    (data) =>
      Boolean(data.path) ||
      Boolean(data.url?.startsWith("file://") || data.url?.startsWith("data:") || data.url?.startsWith("session:")),
  )

export type MessageFile = z.infer<typeof file>

export function parseMessageFiles(value: unknown) {
  const files = z.array(z.unknown()).optional().catch(undefined).parse(value)
  const parsed = files?.flatMap((item) => {
    const result = file.safeParse(item)
    return result.success ? [result.data] : []
  })
  return parsed && parsed.length > 0 ? parsed : undefined
}

/**
 * 把 webview 传来的附件解析为可发送的 file part。
 *
 * `path` 形式的附件（相对或绝对）相对会话目录 `dir` 解析，并做归属校验：
 * 解析结果必须位于会话目录内，否则返回 undefined 丢弃该附件——自动附加会让
 * 后端直接读取文件内容、绕过权限系统（包括此前的 deny 决定），因此会话目录外
 * 的文件只能由模型通过 Read 工具（走正常的外部目录权限检查）读取。
 * 这也让 workspace 内的绝对路径 mention 恢复为可自动附加：webview 端不掌握
 * 会话目录（worktree/远程场景与窗口工作区根不同），归属判断收敛到这里。
 *
 * `url` 形式（file://、data:、session:）不在此校验：file:// URL 由 webview 端
 * buildFileAttachments 在生成时完成归属检查，data:/session: 没有路径语义。
 */
export function resolveMessageFile(file: MessageFile, dir: string) {
  if (file.path) {
    const target = path.isAbsolute(file.path) ? path.normalize(file.path) : path.resolve(dir, file.path)
    const rel = path.relative(dir, target)
    // rel 为空串表示就是会话目录本身；rel 恰为 ".." 或以 "../" 开头（或解析为
    // 绝对路径、Windows 下跨盘符）表示越界。注意不能用 startsWith("..")：
    // 会话目录内名为 "..config" 之类的文件其 rel 同样以 ".." 开头，会被误拒（F60）。
    if (rel !== "" && (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) return undefined
    return {
      type: "file" as const,
      mime: file.mime,
      url: pathToFileURL(target).href,
      filename: file.filename,
      source: file.source,
    }
  }
  return {
    type: "file" as const,
    mime: file.mime,
    url: file.url!,
    filename: file.filename,
    source: file.source,
  }
}
