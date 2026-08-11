import type { KiloClient } from "@kilocode/sdk/v2/client"

// kilocode_change - client 可为 null（后端未连接时），保留 null 防御；其余采上游 Promise 包装
export async function hasGit(client: KiloClient | null, directory: string): Promise<boolean> {
  if (!client) return false
  return Promise.resolve()
    .then(() => client.project.current({ directory }))
    .then((r) => r.data?.vcs === "git")
    .catch(() => false)
}
