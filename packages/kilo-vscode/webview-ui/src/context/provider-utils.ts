import type { Provider, ProviderModel, ModelSelection } from "../types/messages"
import { isSmall } from "../components/shared/model-selector-utils"
import { KILO_PROVIDER_ID } from "../../../src/shared/provider-model"

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
