import type { ModelSelection } from "../../types/messages"
import type { EnrichedModel } from "../../context/provider"
import {
  KILO_PROVIDER_ID as KILO_GATEWAY_ID,
  PROVIDER_PRIORITY as PROVIDER_ORDER,
  providerOrderIndex,
  KILO_AUTO_SMALL_IDS,
  isSmall,
} from "../../../../src/shared/provider-model"

// isSmall / KILO_AUTO_SMALL_IDS 的实现已下沉到 src/shared/provider-model.ts
// （消除 context 层对组件层的反向依赖），此处 re-export 保持既有导入路径兼容。
export { KILO_GATEWAY_ID, PROVIDER_ORDER, KILO_AUTO_SMALL_IDS, isSmall }

export const KILO_AUTO_EFFICIENT_ID = "kilo-auto/efficient"
const AUTO_FALLBACK = "Routes requests automatically."

interface Choice {
  id: string
  name: string
}

export function isAuto(model: Pick<EnrichedModel, "providerID" | "id">): boolean {
  return (
    model.providerID === KILO_GATEWAY_ID && (model.id.startsWith("kilo-auto/") || KILO_AUTO_SMALL_IDS.has(model.id))
  )
}

export function isAutoEfficient(model: Pick<EnrichedModel, "providerID" | "id">): boolean {
  return model.providerID === KILO_GATEWAY_ID && model.id === KILO_AUTO_EFFICIENT_ID
}

export function autoChoices(
  model: Pick<EnrichedModel, "providerID" | "id" | "autoRouting">,
  catalog: readonly Pick<EnrichedModel, "id" | "name">[] = [],
): readonly Choice[] {
  if (!isAutoEfficient(model)) return []
  const ids = model.autoRouting?.models
  if (!ids?.length) return []
  const names = new Map(catalog.map((item) => [item.id, stripSubProviderPrefix(sanitizeName(item.name))]))
  return ids.map((id) => ({ id, name: names.get(id) ?? id }))
}

export function autoSummary(model: Pick<EnrichedModel, "options">): string {
  const raw = model.options?.description?.split(/\n\s*\n/)[0]
  if (!raw) return AUTO_FALLBACK
  return raw.replace(/\s+/g, " ").trim() || AUTO_FALLBACK
}

export function providerSortKey(providerID: string, order: readonly string[] = PROVIDER_ORDER): number {
  return providerOrderIndex(providerID, order as typeof PROVIDER_ORDER)
}

export function isFree(model: Pick<EnrichedModel, "isFree">): boolean {
  return model.isFree === true
}

export function isDataCollectedModel(model: Pick<EnrichedModel, "mayTrainOnYourPrompts">): boolean {
  return model.mayTrainOnYourPrompts === true
}

export function hasByok(model: Pick<EnrichedModel, "hasUserByokAvailable">): boolean {
  return model.hasUserByokAvailable === true
}

export function freeDataLabel(_free: string, data: string): string {
  return data
}

// Strips trailing "(free)" parenthesized suffix from model display names, e.g.
// "Llama 3 (free)" → "Llama 3". A separate "Free" label/tag is rendered
// elsewhere, so preserve bare trailing "Free" words (e.g. "Kilo Auto Free").
export function sanitizeName(name: string): string {
  return name.replace(/[\s:_-]*\(free\)\s*$/i, "").trim()
}

export function stripSubProviderPrefix(name: string): string {
  const colon = name.indexOf(": ")
  if (colon < 0) return name
  const prefix = name.slice(0, colon)
  if (prefix.toLowerCase() === KILO_GATEWAY_ID) return name
  return name.slice(colon + 2)
}

/**
 * 触发器标签的语义场景：
 *
 * - "configured"（默认，设置页）：标签展示的是"配置文件中记录的值本身"。
 *   即使 providers 已加载而该选择不可解析（provider 未连接、Kilo 付费模型、
 *   模型被删等），配置值依然真实存在且在 provider 重连后会立即恢复生效，
 *   必须按上游行为以 "providerID / modelID" 原样显示，
 *   避免显示 "Not set" 误导用户以为未配置而重新设置覆盖原值。
 * - "resolved"（聊天选择器，需显式传入）：标签展示的是"实际将被使用的模型"。
 *   providers 权威快照加载完成后仍无法解析的 raw 选择会被模型回退逻辑忽略，
 *   因此不再显示 raw 兜底，避免界面显示一个实际不会被使用的模型。
 *
 * 默认值取 "configured"（＝上游 v7.4.16 的原始行为，F65）：这样未来上游合并
 * 新增的调用点（不会传本 fork 新增的语义参数）自动获得上游行为；"resolved"
 * 是本 fork 的行为收窄，只在聊天路径显式声明。
 */
export type TriggerLabelSemantics = "resolved" | "configured"

export function buildTriggerLabel(
  resolvedName: string | undefined,
  providerID: string | undefined,
  providerName: string | undefined,
  raw: ModelSelection | null,
  allowClear: boolean,
  clearLabel: string,
  hasProviders: boolean,
  labels: { select: string; noProviders: string; notSet: string },
  semantics: TriggerLabelSemantics = "configured",
): string {
  if (resolvedName) {
    if (providerID === KILO_GATEWAY_ID) return stripSubProviderPrefix(resolvedName)
    if (providerName) return `${providerName} / ${resolvedName}`
    return resolvedName
  }
  // raw 兜底显示：configured 语义下始终显示（上游行为）；
  // resolved 语义下仅在 providers 尚未加载（无法判断可用性）时显示。
  if (raw?.providerID && raw?.modelID && (semantics === "configured" || !hasProviders)) {
    return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
  }
  if (allowClear) return clearLabel || labels.notSet
  return hasProviders ? labels.select : labels.noProviders
}
