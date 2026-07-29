import type * as Provider from "@/provider/provider"

function unique(list: string[]) {
  return [...new Set(list)]
}

function anthropicOpus47OrLater(apiId: string) {
  const version = /opus-(\d+)[.-](\d+)(?:[.@-]|$)/i.exec(apiId)
  if (!version) return false
  const major = Number(version[1])
  const minor = Number(version[2])
  return major > 4 || (major === 4 && minor >= 7)
}

function anthropicLike(model: Provider.Model) {
  const id = `${model.id} ${model.api.id} ${model.name} ${model.api.npm}`.toLowerCase()
  return id.includes("claude") || id.includes("anthropic")
}

function effortOptions(model: Provider.Model) {
  const opts = model.reasoning_options ?? []
  const item = opts.find((opt) => opt.type === "effort" && Array.isArray(opt.values))
  const values = item ? (item.values as unknown[]) : []
  return unique(values.filter((value): value is string => typeof value === "string" && value.length > 0))
}

function summarized(apiId: string) {
  const id = apiId.toLowerCase()
  return anthropicOpus47OrLater(id) || id.includes("fable-5") || id.includes("mythos") || id.includes("sonnet-5")
}

export function metadataVariants(model: Provider.Model): Record<string, Record<string, unknown>> | undefined {
  if (!model.capabilities.reasoning || !anthropicLike(model)) return
  const efforts = effortOptions(model)
  if (efforts.length === 0) return

  if (model.api.npm === "@openrouter/ai-sdk-provider" || model.api.npm === "@kilocode/kilo-gateway") {
    return Object.fromEntries(efforts.map((effort) => [effort, { reasoning: { effort } }]))
  }

  if (model.api.npm === "ai-gateway-provider") {
    return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
  }

  if (model.api.npm === "@ai-sdk/amazon-bedrock") {
    return Object.fromEntries(
      efforts.map((effort) => [
        effort,
        {
          reasoningConfig: {
            type: "adaptive",
            maxReasoningEffort: effort,
            ...(summarized(model.api.id) ? { display: "summarized" } : {}),
          },
        },
      ]),
    )
  }

  if (
    model.api.npm === "@ai-sdk/anthropic" ||
    model.api.npm === "@ai-sdk/google-vertex/anthropic" ||
    model.api.npm === "@ai-sdk/gateway"
  ) {
    return Object.fromEntries(
      efforts.map((effort) => [
        effort,
        {
          thinking: {
            type: "adaptive",
            ...(summarized(model.api.id) ? { display: "summarized" } : {}),
          },
          effort,
        },
      ]),
    )
  }

  if (model.api.npm === "@ai-sdk/openai-compatible") {
    return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
  }
}

function glm52(model: Provider.Model) {
  const id = model.id.toLowerCase()
  const api = model.api.id.toLowerCase()
  return ["glm-5.2", "glm-5-2", "glm-5p2"].some((name) => id.includes(name) || api.includes(name))
}

// 此函数会先于共享 provider/transform.ts 的 GLM-5.2 分支返回；升级上游时需对照同步变体形状和顺序。
// 变体键序与上游 v7.4.16 保持一致（high 在前，更强档位在后），键序影响 UI 展示顺序
// 与默认档位选择；@ai-sdk/openai 分支为 Kilo 新增（上游无），顺序对齐同族分支。
function glm52Variants(model: Provider.Model): Record<string, Record<string, unknown>> | undefined {
  if (!model.capabilities.reasoning || !glm52(model)) return
  if (model.api.npm === "@openrouter/ai-sdk-provider") {
    return {
      high: { reasoning: { effort: "high" } },
      xhigh: { reasoning: { effort: "xhigh" } },
    }
  }
  if (model.api.npm === "@ai-sdk/openai-compatible" || model.api.npm === "@ai-sdk/openai") {
    return {
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    }
  }
  if (model.api.npm === "@ai-sdk/anthropic") {
    return {
      high: { effort: "high" },
      max: { effort: "max" },
    }
  }
}

export function variants(model: Provider.Model): Record<string, Record<string, unknown>> | undefined {
  if (
    ["@kilocode/kilo-gateway", "@ai-sdk/openai-compatible"].includes(model.api.npm) &&
    model.variants &&
    Object.keys(model.variants).length > 0
  ) {
    return model.variants
  }

  return metadataVariants(model) ?? glm52Variants(model)
}
