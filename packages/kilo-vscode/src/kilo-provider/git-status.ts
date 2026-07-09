import type { KiloClient } from "@kilocode/sdk/v2/client"

export async function hasGit(client: KiloClient | null, directory: string): Promise<boolean> {
  if (!client) return false
  return client.project
    .current({ directory })
    .then((r) => r.data?.vcs === "git")
    .catch(() => false)
}
