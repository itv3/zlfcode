import { Provider } from "@/provider/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"

export type Input = {
  providerID: ProviderV2.ID
  modelIDs: readonly ModelV2.ID[]
}

export type Result = {
  ready: boolean
  missing: ModelV2.ID[]
  unexpected: ModelV2.ID[]
}

const inspect = Effect.fn("ProviderReady.inspect")(function* (input: Input) {
  const provider = yield* Provider.Service
  const current = (yield* provider.list())[input.providerID]
  const expected = new Set(input.modelIDs)
  const actual = new Set(Object.keys(current?.models ?? {}).map((id) => ModelV2.ID.make(id)))
  const missing = input.modelIDs.filter((id) => !actual.has(id))
  const unexpected = [...actual].filter((id) => !expected.has(id))
  if (missing.length > 0 || unexpected.length > 0) return { ready: false, missing, unexpected }

  return { ready: true, missing, unexpected }
})

export const check = Effect.fn("ProviderReady.check")(function* (input: Input) {
  const first = yield* inspect(input)
  if (first.ready) return first
  // 第一次检查不通过时只失效当前实例的 Provider 状态后重查（审核条目 F39）。
  // 此前这里调用全局 ModelsRefresh.notify()，会连带失效所有工作区实例并在
  // 下次读取时触发各自的完整重建（含 custom loader、gitlab 模型发现等较重
  // 操作），诊断接口的失败路径代价过高。其他实例的配置变化由各自 current()
  // 的配置引用比对兜底，无需在此全局失效。
  const provider = yield* Provider.Service
  if (provider.invalidate) yield* provider.invalidate()
  return yield* inspect(input)
})
