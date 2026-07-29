// 自定义 Provider 的模型编译共享实现。
//
// 背景（审核条目 F10/F37）：provider.ts 的全量构建路径与 config-refresh.ts 的
// 增量刷新路径此前各自维护一份几乎相同的模型编译逻辑（capabilities/cost/limit/
// headers 的 fallback 链、patchConfigModel、orderedVariants、status 过滤、
// black/whitelist、空 variants 兜底、env key 解析）。两份拷贝会随上游升级逐渐
// 漂移，出现"热更新后行为 A、重启后行为 B"的隐性不一致。本模块把这些逻辑
// 收敛为单一实现，两条路径共同调用，语义以全量构建（provider.ts）为准。
//
// 注意：本模块必须保持纯函数（不访问服务、不做 IO），使增量刷新产物与
// 全量重建产物可以逐字段对拍（见 provider-config-refresh.test.ts）。

import { orderedVariants, patchConfigModel } from "@/kilocode/provider/provider"
import type { Info, Model } from "@/provider/provider"
import * as ProviderTransform from "@/provider/transform"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { mapValues, mergeDeep } from "remeda"

/**
 * models.dev 目录中该 Provider 的兜底字段。全量构建传入 modelsDev[providerID]
 * 供 npm / api 的 fallback 链使用；增量刷新只处理非目录 Provider（守卫要求
 * `!catalog[id]`），此时该条目必然不存在，不传参与全量语义等价。
 */
export type ModelsDevFallback = {
  npm?: string
  api?: string
}

/**
 * 从配置段编译 Provider 顶层信息（不含 key，key 由调用方按各自的
 * auth / env 语义单独注入）。models 直接沿用 base 的模型表，与全量构建的
 * `models: existing?.models ?? {}` 语义一致，后续由 compileConfigModels
 * 就地写入配置模型。
 *
 * 【可变性契约（F67 备注 / 原 F10 修复的既定语义）】返回值的 `models` 与
 * `base.models` 是同一个对象引用，compileConfigModels 会就地写入——这是刻意
 * 对齐上游全量构建的行为（上游同样共享引用）。因此调用方绝不能把"运行时
 * 注册表中仍在使用的 provider 对象"直接作为 base 传入，否则会就地污染活动
 * 状态；如需基于活动对象编译，先自行深拷贝再传入。当前两个调用方均安全：
 * 全量构建传入的是本轮新建的 database 条目，增量刷新（config-refresh.build）
 * 不传 base。
 */
export function compileProviderInfo(input: {
  id: ProviderV2.ID
  config: ConfigProviderV1.Info
  base?: Info
}): Info {
  return {
    id: input.id,
    name: input.config.name ?? input.base?.name ?? input.id,
    env: input.config.env ?? input.base?.env ?? [],
    options: mergeDeep(input.base?.options ?? {}, input.config.options ?? {}),
    source: "config",
    models: input.base?.models ?? {},
  }
}

/**
 * 把配置中的模型逐个编译进 models 表（就地写入）。每个字段的 fallback 链
 * 逐字段对照 provider.ts 全量构建路径："配置值 → 既有模型值 → models.dev
 * 目录值（仅全量传入）→ 内置默认值"。
 */
export function compileConfigModels(input: {
  providerID: ProviderV2.ID
  config: ConfigProviderV1.Info
  models: Record<string, Model>
  modelsDev?: ModelsDevFallback
}): void {
  const config = input.config
  for (const [modelID, configModel] of Object.entries(config.models ?? {})) {
    if (!configModel) continue // null 条目是删除哨兵，跳过
    const existing = input.models[configModel.id ?? modelID]
    const apiID = configModel.id ?? existing?.api.id ?? modelID
    const apiNpm =
      configModel.provider?.npm ??
      config.npm ??
      existing?.api.npm ??
      input.modelsDev?.npm ??
      "@ai-sdk/openai-compatible"
    const name = (() => {
      if (configModel.name) return configModel.name
      if (configModel.id && configModel.id !== modelID) return modelID
      return existing?.name ?? modelID
    })()
    const model: Model = {
      id: ModelV2.ID.make(modelID),
      api: {
        id: apiID,
        npm: apiNpm,
        url: configModel.provider?.api ?? config.api ?? existing?.api.url ?? input.modelsDev?.api ?? "",
      },
      status: configModel.status ?? existing?.status ?? "active",
      name,
      providerID: input.providerID,
      capabilities: {
        temperature: configModel.temperature ?? existing?.capabilities.temperature ?? false,
        reasoning: configModel.reasoning ?? existing?.capabilities.reasoning ?? false,
        attachment: configModel.attachment ?? existing?.capabilities.attachment ?? false,
        toolcall: configModel.tool_call ?? existing?.capabilities.toolcall ?? true,
        input: {
          text: configModel.modalities?.input?.includes("text") ?? existing?.capabilities.input.text ?? true,
          audio: configModel.modalities?.input?.includes("audio") ?? existing?.capabilities.input.audio ?? false,
          image: configModel.modalities?.input?.includes("image") ?? existing?.capabilities.input.image ?? false,
          video: configModel.modalities?.input?.includes("video") ?? existing?.capabilities.input.video ?? false,
          pdf: configModel.modalities?.input?.includes("pdf") ?? existing?.capabilities.input.pdf ?? false,
        },
        output: {
          text: configModel.modalities?.output?.includes("text") ?? existing?.capabilities.output.text ?? true,
          audio: configModel.modalities?.output?.includes("audio") ?? existing?.capabilities.output.audio ?? false,
          image: configModel.modalities?.output?.includes("image") ?? existing?.capabilities.output.image ?? false,
          video: configModel.modalities?.output?.includes("video") ?? existing?.capabilities.output.video ?? false,
          pdf: configModel.modalities?.output?.includes("pdf") ?? existing?.capabilities.output.pdf ?? false,
        },
        interleaved:
          configModel.interleaved ??
          existing?.capabilities.interleaved ??
          (!existing && apiNpm === "@ai-sdk/openai-compatible" && apiID.includes("deepseek")
            ? { field: "reasoning_content" }
            : false),
      },
      cost: {
        input: configModel.cost?.input ?? existing?.cost?.input ?? 0,
        output: configModel.cost?.output ?? existing?.cost?.output ?? 0,
        cache: {
          read: configModel.cost?.cache_read ?? existing?.cost?.cache.read ?? 0,
          write: configModel.cost?.cache_write ?? existing?.cost?.cache.write ?? 0,
        },
      },
      options: mergeDeep(existing?.options ?? {}, configModel.options ?? {}),
      limit: {
        context: configModel.limit?.context ?? existing?.limit?.context ?? 0,
        input: configModel.limit?.input ?? existing?.limit?.input,
        output: configModel.limit?.output ?? existing?.limit?.output ?? 0,
      },
      headers: mergeDeep(existing?.headers ?? {}, configModel.headers ?? {}),
      family: configModel.family ?? existing?.family ?? "",
      release_date: configModel.release_date ?? existing?.release_date ?? "",
      ...patchConfigModel(configModel, existing),
    }
    // 保留配置中的 variants 顺序，供自定义默认值使用
    model.variants = orderedVariants(ProviderTransform.variants(model), configModel.variants ?? {})
    input.models[modelID] = model
  }
}

/**
 * Provider 模型的最终过滤与兜底（就地修改），与 provider.ts 全量构建的
 * 后处理循环逐条对应：api.id 兜底、内置 Provider 的 gpt-5-chat 别名剔除、
 * alpha/deprecated 状态过滤、black/whitelist、空 variants 兜底、按配置
 * variants 顺序重排。调用方负责处理"模型清空后删除整个 Provider"。
 */
export function finalizeProviderModels(input: {
  provider: Info
  configProvider: ConfigProviderV1.Info | null | undefined
  experimental: boolean
}): void {
  const provider = input.provider
  const providerID = provider.id
  const configProvider = input.configProvider
  for (const [modelID, model] of Object.entries(provider.models)) {
    model.api.id = model.api.id ?? model.id ?? modelID
    if (
      // These chat aliases are invalid for the special handling in the
      // built-in providers below, but custom providers may support them.
      (modelID === "gpt-5-chat-latest" &&
        (providerID === ProviderV2.ID.openai ||
          providerID === ProviderV2.ID.githubCopilot ||
          providerID === ProviderV2.ID.openrouter)) ||
      (providerID === ProviderV2.ID.openrouter && modelID === "openai/gpt-5-chat")
    )
      delete provider.models[modelID]
    if (model.status === "alpha" && !input.experimental) delete provider.models[modelID]
    if (model.status === "deprecated") delete provider.models[modelID]
    if (
      (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
      (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
    )
      delete provider.models[modelID]

    if (!model.variants || Object.keys(model.variants).length === 0) {
      model.variants = mapValues(ProviderTransform.variants(model), (v) => v)
    }

    const configVariants = configProvider?.models?.[modelID]?.variants
    if (configVariants && model.variants) {
      // 保留配置中的 variants 顺序，供自定义默认值使用
      model.variants = orderedVariants(model.variants, configVariants)
    }
  }
}

/**
 * 按全量构建语义解析 env var 形式的 API key（审核条目 F37）：
 * - 任一 env var 有值即视为"找到"（found 用于全量构建激活 source: "env"）；
 * - 只有恰好声明一个 env var 时才把值作为 key 注入，声明多个时 key 保持
 *   undefined，交由 SDK 自行读取环境变量。
 * 增量刷新与全量构建共用本函数，保证热更新与重启后的 key 注入行为一致。
 */
export function resolveEnvApiKey(
  envNames: readonly string[] | null | undefined,
  envs: Record<string, string | undefined>,
): { found: boolean; key: string | undefined } {
  const names = envNames ?? []
  const value = names.map((name) => envs[name]).find(Boolean)
  if (!value) return { found: false, key: undefined }
  return { found: true, key: names.length === 1 ? value : undefined }
}
