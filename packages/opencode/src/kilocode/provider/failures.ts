import { Effect } from "effect"
import type { ModelCache } from "@/provider/model-cache"

/** 将模型缓存中的失败转换为客户端共用的错误原因，保留可用的 HTTP 状态码。 */
export function failures(cache: ModelCache.Interface, ids: string[]) {
  return Effect.forEach(ids, (id) =>
    cache.getFailure(id).pipe(
      Effect.map((failure) => ({
        providerID: id,
        kind: failure?.kind ?? ("http" as const),
        ...(failure?.status == null ? {} : { status: failure.status }),
      })),
    ),
  )
}
