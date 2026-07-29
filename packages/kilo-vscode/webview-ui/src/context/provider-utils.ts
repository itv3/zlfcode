import type { Provider, ProviderModel, ModelSelection } from "../types/messages"
// isSmall 来自共享层 provider-model，避免 context 层反向依赖组件层的
// model-selector-utils（后者又 type-import context 层，形成层次倒挂）。
import { isSmall, KILO_PROVIDER_ID } from "../../../src/shared/provider-model"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

/**
 * Flatten a provider map into a list of models enriched with provider info.
 */
export function flattenModels(providers: Record<string, Provider>): EnrichedModel[] {
  const result: EnrichedModel[] = []
  for (const providerID of Object.keys(providers)) {
    const provider = providers[providerID]!
    for (const modelID of Object.keys(provider.models)) {
      result.push({
        ...provider.models[modelID]!,
        id: modelID,
        providerID,
        providerName: provider.name,
      })
    }
  }
  return result
}

/**
 * Find an enriched model from a flat model list by provider ID and model ID.
 */
export function findModel(models: EnrichedModel[], selection: ModelSelection | null): EnrichedModel | undefined {
  if (!selection) return undefined
  return models.find((m) => m.providerID === selection.providerID && m.id === selection.modelID)
}

export function isVisibleModel(
  model: Pick<EnrichedModel, "providerID" | "id" | "isFree">,
  connected: readonly string[],
  includeSmall = false,
): boolean {
  if (!includeSmall && isSmall(model)) return false
  if (model.providerID === KILO_PROVIDER_ID) return model.isFree === true
  return connected.includes(model.providerID)
}

export function visibleModels(models: EnrichedModel[], connected: readonly string[], includeSmall = false) {
  return models.filter((model) => isVisibleModel(model, connected, includeSmall))
}

/**
 * True when the selection points to an existing model in a connected provider.
 * Kilo gateway models remain usable only when they are visible free models.
 */
export function isModelValid(
  providers: Record<string, Provider>,
  connected: string[],
  selection: ModelSelection | null,
): boolean {
  if (!selection) return false
  const provider = providers[selection.providerID]
  if (!provider) return false
  const model = provider.models[selection.modelID]
  if (!model) return false
  return isVisibleModel({ ...model, providerID: selection.providerID }, connected)
}

/**
 * 判断一个模型选择当前是否"可用"，带 providers 未加载时的豁免语义：
 *
 * - selection 为空 → 不可用；
 * - providers 快照为空（扩展端权威快照尚未到达，例如启动窗口或后端重连期间）
 *   → 无法判断有效性，此时一律视为可用，避免把用户既有选择误判为失效；
 * - providers 就绪后 → 委托 isModelValid 做完整校验（provider 存在、模型存在、
 *   已连接或为 Kilo 免费模型）。
 *
 * 此前该豁免逻辑在 session.tsx、NewWorktreeDialog.tsx、session-model-store.ts
 * 三处各自实现一份，语义调整需人工同步；现统一收敛到这里，调用方一律复用。
 */
export function isModelUsable(
  providers: Record<string, Provider>,
  connected: string[],
  selection: ModelSelection | null | undefined,
): selection is ModelSelection {
  if (!selection) return false
  if (Object.keys(providers).length === 0) return true
  return isModelValid(providers, connected, selection)
}
