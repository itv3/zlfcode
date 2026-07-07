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

const file = z.object({
  mime: z.string(),
  url: z.string().optional(),
  path: z.string().min(1).optional(),
  filename: z.string().optional(),
  source: source.optional(),
}).refine((data) => Boolean(data.path) || Boolean(data.url?.startsWith("file://") || data.url?.startsWith("data:")))

export type MessageFile = z.infer<typeof file>

export function parseMessageFiles(value: unknown) {
  const files = z.array(z.unknown()).optional().catch(undefined).parse(value)
  const parsed = files?.flatMap((item) => {
    const result = file.safeParse(item)
    return result.success ? [result.data] : []
  })
  return parsed && parsed.length > 0 ? parsed : undefined
}

export function resolveMessageFile(file: MessageFile, dir: string) {
  const target = file.path && (path.isAbsolute(file.path) ? file.path : path.resolve(dir, file.path))
  return {
    type: "file" as const,
    mime: file.mime,
    url: target ? pathToFileURL(target).href : file.url!,
    filename: file.filename,
    source: file.source,
  }
}
