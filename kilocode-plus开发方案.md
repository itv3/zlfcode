# Kilo Code Plus · 开发方案

## 0. 本轮目标

Kilo Code Plus 是基于上游 Kilo Code 的 Plus 发行版。本轮升级不做普通历史 merge，而是从官方 `v7.4.1` 新建干净分支，只移植 Plus 功能文件、发布身份文件、workflow、README 和版本号补丁。

| 项 | 结论 |
|---|---|
| 产品名 | `Kilo Code Plus` |
| 目标编辑器 | Cursor + VS Code |
| 上游底座 | Kilo Code `v7.4.1` |
| 发布批次 | `7.4.1-v0.03` |
| 市场版本 | `7.4.103` |
| 扩展 ID | `itv3.kilo-code-plus` |
| 内部命令 ID | 保留 `kilo-code.*` / `kilo-code-ActivityBar` |
| 维护方式 | 后续继续以官方 tag 为干净底座，重放 Plus 最小功能补丁 |

维护原则：

1. 优先把 Plus 改动放在 `packages/kilo-vscode` 和 `packages/opencode/src/kilocode/`。
2. 共享 `packages/opencode` 文件只保留必要小补丁，并用 `kilocode_change` 标记。
3. 智能体中文化只改 UI 展示，不改 agent 内部 `name` 或系统 `prompt`。
4. `orchestrator` 只在 VS Code 扩展展示/可选列表隐藏，不删除核心定义。
5. 不删除、不重命名上游导出符号；需要改变行为时，保留兼容壳并把新逻辑放到清晰边界内。
6. 保留官方 `v7.4.1` 已有的 sandbox、Agent Manager 弹层修复、模型选择器虚拟列表、可访问性和自定义 provider 基础能力；Plus 只补本文列出的增强，不重放旧实现。

## 1. 功能一 · UI 页面自定义提供商增强

### 1.1 功能范围

| 功能 | 说明 |
|---|---|
| API 格式 | 自定义提供商支持 OpenAI / Anthropic / Gemini 三种原生格式 API。 |
| 模型自动发现 | 支持 OpenAI、Anthropic、Gemini，并自动处理 endpoint 和认证头。 |
| 自动发现交互优化 | 默认不全选，已添加模型不再显示，删除已添加模型后会重新拉取模型列表。 |
| 高级参数配置 | 支持配置图像输入能力、推理能力、`context token limit`、`output token limit`，以及输入、输出、缓存读取、缓存写入成本。 |
| 默认参数匹配 | 添加模型时优先用模型 ID 精确匹配内置默认模型，自动带入能力、成本和 token limit；未命中时显示候选模型列表 |
| 候选模型预览 | 候选模型支持 hover 预览，显示图片、推理、上下文/输出 token、成本和推理强度等默认参数。 |
| 配置界面增强 | 优化自定义提供商配置界面布局、提示语和参数命名，减少表单高度。 |

### 1.2 关键实现

模型发现支持四类包名到三种协议的映射：

| `form.npm` | 协议 | 发现规则 |
|---|---|---|
| `@ai-sdk/openai-compatible` / `@ai-sdk/openai` | `openai` | 保持用户 `baseURL`，发现时拼 `/models` 并使用 Bearer key |
| `@ai-sdk/anthropic` | `anthropic` | 自动补到 `/v1`，发现时拼 `/models` 并使用 `x-api-key` |
| `@ai-sdk/google` | `gemini` | 自动补到 `/v1beta`，发现时拼 `/models` 并使用 Gemini key |

编辑已有 provider 时，webview 不接收已保存的 API key。扩展端只在 providerID、发现协议和规范化后的 `baseURL` 都匹配时，才复用已保存 key 或 `{env:VAR}`；内置 `openai` / `anthropic` / `google` provider ID 不进入这份缓存。

模型卡片保存字段覆盖 `modalities`、`reasoning`、`limit.context`、`limit.output`、`cost`、`variants` 和 `options.headers`。成本字段只有勾选“成本选项”时才校验和保存；`limit.context` 与 `limit.output` 必须成对填写。删除模型、variant 或模型属性时，保存路径写入 `null` 删除哨兵，再由配置合并和 `stripNulls` 清理旧字段。

默认参数匹配流程：

1. 自动发现返回的 `contextLimit`、`outputLimit`、成本等字段先进入模型卡片。
2. 精确命中的内置 catalog 默认值只补空字段、未开启能力或空 `variants`，不覆盖接口返回值或用户已填写值。
3. 未命中精确默认值时显示最多 5 个候选模型，候选排序考虑 token 命中、覆盖度、顺序、尾缀、精确命中和前缀命中。
4. 用户点击候选项后复制该候选模型的 `limit`、`modalities`、`reasoning`、`cost`、`variants`。

配置界面保持紧凑布局：`Provider API` 与 `BASE_URL` 在桌面宽度下并排显示。

### 1.3 关键文件

| 范围 | 文件 | 说明 |
|---|---|---|
| Extension host | `packages/kilo-vscode/src/KiloProvider.ts` | 分发模型发现请求，带协议调用保存 key/env |
| Extension host | `packages/kilo-vscode/src/provider-actions.ts` | 保存 provider、刷新 catalog、处理 key/env、变体重置、失败回滚和删除哨兵 |
| Shared helper | `packages/kilo-vscode/src/shared/custom-provider.ts` | 自定义 provider schema 与协议字段 |
| Shared helper | `packages/kilo-vscode/src/shared/fetch-models.ts` | OpenAI / Anthropic / Gemini 模型发现 |
| Shared helper | `packages/kilo-vscode/src/shared/provider-model.ts` | provider 协议推断、baseURL 规范化、默认值匹配入口 |
| Webview UI | `CustomProviderDialog.tsx` | 表单、模型发现、默认值合并和候选列表 |
| Webview UI | `CustomProviderDefaults.ts` | 默认参数匹配和候选排序 |
| Webview UI | `CustomProviderModelCard.tsx` | 模型字段、能力、成本和 token limit 编辑 |
| Webview UI | `CustomProviderValidation.ts` | 保存前校验 |
| Webview UI | `CustomProviderVariants.ts` | reasoning variant 编辑 |
| `opencode` 触点 | `packages/opencode/src/config/provider.ts` | 删除哨兵 |
| `opencode` 触点 | `packages/opencode/src/provider/transform.ts` | provider transform 兼容 |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/provider/{provider,transform}.ts` | Kilo 专属 provider transform |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/server/provider-auth-lifecycle.ts` | provider env/auth 顺序和模型缓存刷新 |

## 2. 功能二 · 模型列表过滤、排序与选择体验

### 2.1 功能范围

| 功能 | 说明 |
|---|---|
| 模型列表过滤与排序 | 默认仅显示 Kilo Gateway 免费模型以及用户已添加或已连接提供商的模型，用户 provider 排在免费模型前面。 |
| 模型选择器交互 | 模型选择器默认折叠详情页，单击模型即可直接切换。 |
| 默认收藏 | 首次没有收藏记录时默认收藏 StepFun Step 3.7 Flash 免费模型，用户取消后不会自动恢复。 |

### 2.2 关键实现

实际代码通过 `isVisibleModel` / `isModelValid` 统一模型可见性判断，并使用 `KILO_PROVIDER_ID` 判断 Kilo 官方 provider。

| provider | 规则 |
|---|---|
| `kilo` | 只保留 `model.isFree === true` 的免费模型 |
| 已连接 provider | 保留该 provider 的全部模型 |
| 未连接 provider | 不在可选模型列表显示 |

注意：不要用 `provider.source === "custom"` 判断用户自定义添加。models.dev 目录导入的普通 provider 也可能带 `source: "custom"`，会误放出未添加模型。

注意：完整 catalog 会留在 webview 状态中。任何新入口如果直接渲染 `provider.models` 或只判断模型存在，都会绕过过滤；新增模型展示、默认选择、历史选择、通知推荐、多模型选择、会话覆盖和 Agent Manager 新 worktree 创建等路径必须复用 `isVisibleModel` 或基于它的 `isModelValid`。

默认收藏通过 `FAVORITES_SEEDED_KEY` 控制：只有首次没有收藏记录时注入 StepFun Step 3.7 Flash 免费模型；用户清空后不会自动恢复。

### 2.3 关键文件

| 范围 | 文件 | 说明 |
|---|---|---|
| 数据下发 | `packages/kilo-vscode/src/KiloProvider.ts` | 下发完整 provider catalog 和 connected provider 列表 |
| 收藏清理 | `packages/kilo-vscode/src/provider-actions.ts` | 校验收藏模型并维护默认收藏初始化状态 |
| 单一入口 | `packages/kilo-vscode/webview-ui/src/context/provider-utils.ts` | `isVisibleModel` / `isModelValid` |
| 会话状态 | `packages/kilo-vscode/webview-ui/src/context/session.tsx` | 防御不可见的会话覆盖、最近模型和 pending Kilo 模型 |
| UI 入口 | `ModelSelector.tsx` / `MultiModelSelector.tsx` / `NewWorktreeDialog.tsx` | 主选择器、Agent Manager 多模型选择和 worktree 创建都复用可见性判断 |

## 3. 功能三 · 智能体中文化与隐藏 orchestrator

### 3.1 功能范围

| 功能 | 说明 |
|---|---|
| 内置智能体中文说明 | 在设置页“智能体行为 > 代理”和聊天窗口智能体选择器中，`ask` / `code` / `debug` / `explore` / `general` / `plan` 显示中文说明。 |
| 隐藏 `orchestrator` | 在 VS Code 扩展的可选列表中隐藏内置 `orchestrator`，核心定义仍保留。 |

边界：只调整界面展示文案；用户自定义智能体不翻译，内部 `name` 和系统 `prompt` 不修改。

### 3.2 关键实现

| 范围 | 处理 |
|---|---|
| `KiloProvider.fetchAndSendAgents()` | 后端返回 agents 后先调用 `filterAgents`，再生成 `agentsLoaded` |
| `filterVisibleAgents()` | 继续过滤 `subagent` 和 `hidden`，并防御性排除内置 `orchestrator` |
| `AgentBehaviourTab` | 从配置对象补充 agent 名称时，已知同名自定义 agent 保留；缺失定义的内置 `orchestrator` 仍按隐藏处理 |
| `ModeSwitcher` | 使用 `agentLabel()` 和 `agentDescription()` 获取本地化展示 |

关键文件集中在 `packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/src/kilo-provider-utils.ts`、`webview-ui/src/utils/agent-display.ts`、`ModeSwitcher.tsx`、`AgentBehaviourTab.tsx` 和三份 i18n 文件。

本功能没有修改 `packages/opencode/src/agent/agent.ts`、`packages/opencode/src/kilocode/agent/index.ts` 或 `packages/kilo-indexing/src/indexing/orchestrator.ts`。

## 4. 发布与验证

### 4.1 扩展标识与版本规则

| 字段 | 实际值 |
|---|---|
| `displayName` | `Kilo Code Plus` |
| `name` | `kilo-code-plus` |
| `publisher` | `itv3` |
| 市场扩展 ID | `itv3.kilo-code-plus` |
| GitHub 仓库 | `https://github.com/itv3/kilo-code-plus` |
| 当前市场版本 | `7.4.103` |
| 当前发布批次 | `7.4.1-v0.03` |
| tag / Release | `kilo-code-plus-v7.4.1-v0.03` |
| darwin arm64 VSIX | `kilo-code-plus-7.4.1-v0.03-darwin-arm64.vsix` |

不要改 `contributes` 里的 `kilo-code.*`、`kilo-code-ActivityBar`、命令 ID 和视图 ID。它们属于运行时和 UI 绑定标识，改动会扩大入侵面并容易导致已有命令、视图、状态迁移失效。

### 4.2 自动测试

发布前检查：

```sh
cd /Users/czs/Developer/kilocode-plus
rg -n "<<<<<<<|>>>>>>>|\\|\\|\\|\\|\\|\\|\\|" .
git diff --check
bun run script/check-workflows.ts
bun run script/check-opencode-annotations.ts --base refs/tags/v7.4.1

cd /Users/czs/Developer/kilocode-plus/packages/kilo-vscode
bun test ./tests/unit/custom-provider-defaults.test.ts ./tests/unit/custom-provider-dialog-validate.test.ts ./tests/unit/custom-provider-variants.test.ts ./tests/unit/custom-provider-model-fetch.test.ts ./tests/unit/custom-provider.test.ts ./tests/unit/fetch-models.test.ts ./tests/unit/provider-actions-save.test.ts
bun test ./tests/unit/provider-actions-validate.test.ts ./tests/unit/i18n-keys.test.ts ./tests/unit/agent-display.test.ts ./tests/unit/kilo-provider-utils.test.ts ./tests/unit/model-selection.test.ts ./tests/unit/provider-utils.test.ts
bun run typecheck

cd /Users/czs/Developer/kilocode-plus/packages/opencode
bun test ./test/kilocode/custom-provider-delete.test.ts ./test/kilocode/provider-transform.test.ts ./test/kilocode/provider-variant-order.test.ts ./test/kilocode/server/provider-auth-lifecycle.test.ts
```

### 4.3 本地打包

标准本地打包：

```sh
cd /Users/czs/Developer/kilocode-plus/packages/kilo-vscode
bun run prepare:cli-binary -- --force
bun run rebuild-sdk
bun run typecheck
node esbuild.js --production
./node_modules/.bin/vsce package --no-dependencies --skip-license --target darwin-arm64 -o out/kilo-code-plus-7.4.1-v0.03-darwin-arm64.vsix
```

### 4.4 安装到 Cursor 后验收

| 项 | 期望 |
|---|---|
| 扩展详情页 | 显示 `Kilo Code Plus` 和中文 Plus 说明 |
| 扩展版本 | 显示市场版本 `7.4.103` |
| 关于页面 | 版本信息不显示 `unknown` |
| 自定义 provider | OpenAI / Anthropic / Gemini 模型发现、保存、请求头、图片能力、推理能力、默认推理强度、token limit、成本选项、默认参数匹配和候选模型预览正常 |
| 模型列表 | 只显示 Kilo Gateway 免费模型以及用户已添加或已连接 provider 的模型 |
| 模型选择器 | 用户 provider 排在免费模型前面，默认折叠详情页，单击模型可直接切换 |
| 默认收藏 | 首次没有收藏记录时注入 StepFun Step 3.7 Flash 免费模型，用户取消后不自动恢复 |
| 智能体列表 | 内置智能体显示中文说明，`orchestrator` 不出现在可选列表 |

自动测试不等于完整验收；发布前必须按上表在 Cursor 中人工逐项通过。

## 5. 上游升级文件索引

本索引用于后续升级时快速定位 Plus 改动。

| 范围 | 文件 |
|---|---|
| 发布与版本 | `.github/release-notes/kilo-code-plus-v7.4.1-v0.01.md` |
| 发布与版本 | `.github/release-notes/kilo-code-plus-v7.4.1-v0.02.md` |
| 发布与版本 | `.github/release-notes/kilo-code-plus-v7.4.1-v0.03.md` |
| 发布与版本 | `.github/workflows/publish-kilo-code-plus.yml` |
| 发布与版本 | `README.md` |
| 发布与版本 | `kilocode-plus开发方案.md` |
| 发布与版本 | `package.json` |
| 发布与版本 | `bun.lock` |
| 发布与版本 | `packages/kilo-vscode/CHANGELOG.md` |
| 发布与版本 | `packages/kilo-vscode/README.md` |
| 发布与版本 | `packages/kilo-vscode/package.json` |
| Extension host | `packages/kilo-vscode/src/KiloProvider.ts` |
| Extension host | `packages/kilo-vscode/src/MarketplacePanelProvider.ts` |
| Extension host | `packages/kilo-vscode/src/extension-info.ts` |
| Extension host | `packages/kilo-vscode/src/kilo-provider-utils.ts` |
| Extension host | `packages/kilo-vscode/src/provider-actions.ts` |
| Shared helper | `packages/kilo-vscode/src/shared/agents.ts` |
| Shared helper | `packages/kilo-vscode/src/shared/custom-provider.ts` |
| Shared helper | `packages/kilo-vscode/src/shared/fetch-models.ts` |
| Shared helper | `packages/kilo-vscode/src/shared/provider-model.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/agent-manager/MultiModelSelector.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/agent-manager/NewWorktreeDialog.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/settings/AgentBehaviourTab.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDefaults.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderModelCard.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderValidation.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderVariants.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/shared/ModeSwitcher.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/context/provider-utils.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/context/session.tsx` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/i18n/en.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/i18n/zh.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/i18n/zht.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/types/messages/webview-messages.ts` |
| Webview UI | `packages/kilo-vscode/webview-ui/src/utils/agent-display.ts` |
| Extension tests | `packages/kilo-vscode/tests/unit/custom-provider-*.test.ts` |
| Extension tests | `packages/kilo-vscode/tests/unit/fetch-models.test.ts` |
| Extension tests | `packages/kilo-vscode/tests/unit/provider-actions-*.test.ts` |
| Extension tests | `packages/kilo-vscode/tests/unit/model-selection.test.ts` |
| Extension tests | `packages/kilo-vscode/tests/unit/provider-utils.test.ts` |
| Extension tests | `packages/kilo-vscode/tests/unit/agent-display.test.ts` |
| Extension tests | `packages/kilo-vscode/tests/unit/kilo-provider-utils.test.ts` |
| `opencode` shared | `packages/opencode/src/config/provider.ts` |
| `opencode` shared | `packages/opencode/src/provider/transform.ts` |
| `opencode` shared | `packages/opencode/src/server/routes/instance/httpapi/public.ts` |
| `opencode` shared | `packages/opencode/script/build.ts` |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/provider/provider.ts` |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/provider/transform.ts` |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/server/httpapi/public.ts` |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/server/provider-auth-lifecycle.ts` |
| `opencode` tests | `packages/opencode/test/kilocode/custom-provider-delete.test.ts` |
| `opencode` tests | `packages/opencode/test/kilocode/provider-transform.test.ts` |
| `opencode` tests | `packages/opencode/test/kilocode/provider-variant-order.test.ts` |
| `opencode` tests | `packages/opencode/test/kilocode/server/provider-auth-lifecycle.test.ts` |
| 工具脚本 | `script/check-opencode-annotations.ts` |
| 工具脚本 | `script/check-md-table-padding.ts` |
| 工具脚本 | `script/check-workflows.ts` |
| SDK 生成物 | `packages/sdk/openapi.json` |
| SDK 生成物 | `packages/sdk/js/src/v2/gen/types.gen.ts` |
