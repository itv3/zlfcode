# ZLF Code

ZLF Code 是面向内部使用的 AI coding agent。本轮升级采用干净底座重建方式：以官方 `v7.4.1` 为基础，只移植 ZLF 自定义功能文件、发布身份文件、workflow、README 和版本号补丁。

## 当前版本

| 项 | 值 |
|---|---|
| 上游底座 | Kilo Code `v7.4.1` |
| ZLF 自定义版本 | `v0.10` |
| 发布批次 | `7.4.1-v0.10` |
| 市场版本 | `7.4.110` |
| 扩展 ID | `itv3.zlfcode` |
| `publisher` | `itv3` |
| `name` | `zlfcode` |
| `displayName` | `ZLF Code` |
| VS Marketplace | `https://marketplace.visualstudio.com/items?itemName=itv3.zlfcode` |
| Open VSX | `https://open-vsx.org/extension/itv3/zlfcode` |
| GitHub 仓库 | `https://github.com/itv3/zlfcode` |

VS Marketplace / Open VSX 的 `package.json.version` 必须是普通 SemVer，所以市场页面显示 `7.4.110`。GitHub tag、GitHub Release 和 VSIX 文件名使用发布批次 `7.4.1-v0.10`。

## 维护原则

本轮升级不做普通历史 merge，而是从官方 `v7.4.1` 新建干净分支，只移植 ZLF 必需功能和发布身份。后续升级继续优先以官方 tag 为干净底座，重放最小补丁。

1. 优先把 ZLF 改动放在 `packages/kilo-vscode` 和 `packages/opencode/src/kilocode/`。
2. 共享 `packages/opencode` 文件只保留必要小补丁，并用 `kilocode_change` 标记。
3. 智能体中文化只改 UI 展示，不改 agent 内部 `name` 或系统 `prompt`。
4. `orchestrator` 只在 VS Code 扩展展示/可选列表隐藏，不删除核心定义。
5. 不删除、不重命名上游导出符号；需要改变行为时，保留兼容壳并把新逻辑放到清晰边界内。
6. 不要改 `contributes` 里的 `kilo-code.*`、`kilo-code-ActivityBar`、命令 ID 和视图 ID。它们属于运行时和 UI 绑定标识，改动会扩大入侵面并容易导致已有命令、视图、状态迁移失效。

## 主要改进

### UI 页面自定义提供商增强

| 功能 | 说明 |
|---|---|
| API 格式 | 自定义提供商支持 OpenAI / Anthropic / Gemini 三种原生格式 API。 |
| 模型自动发现 | 支持 OpenAI、Anthropic、Gemini，并自动处理 endpoint 和认证头。 |
| 自动发现交互优化 | 默认不全选，已添加模型不再显示，删除已添加模型后会重新拉取模型列表。 |
| 高级参数配置 | 支持配置图像输入能力、推理能力、`context token limit`、`output token limit`，以及输入、输出、缓存读取、缓存写入成本。 |
| 默认参数匹配 | 添加模型时优先用模型 ID 精确匹配内置默认模型，自动带入能力、成本和 token limit；未命中时显示候选模型列表 |
| 候选模型预览 | 候选模型支持 hover 预览，显示图片、推理、上下文/输出 token、成本和推理强度等默认参数。 |
| 配置界面增强 | 优化自定义提供商配置界面布局、提示语和参数命名，减少表单高度。 |

关键实现：

- 模型发现支持四类包名到三种协议的映射：

| `form.npm` | 协议 | 发现规则 |
|---|---|---|
| `@ai-sdk/openai-compatible` / `@ai-sdk/openai` | `openai` | 保持用户 `baseURL`，发现时拼 `/models` 并使用 Bearer key。 |
| `@ai-sdk/anthropic` | `anthropic` | 自动补到 `/v1`，发现时拼 `/models` 并使用 `x-api-key`。 |
| `@ai-sdk/google` | `gemini` | 自动补到 `/v1beta`，发现时拼 `/models` 并使用 Gemini key。 |

- 编辑已有 provider 时，webview 不接收已保存的 API key。扩展端只在 providerID、发现协议和规范化后的 `baseURL` 都匹配时，才复用已保存 key 或 `{env:VAR}`；内置 `openai` / `anthropic` / `google` provider ID 不进入这份缓存。
- 模型卡片保存字段覆盖 `modalities`、`reasoning`、`limit.context`、`limit.output`、`cost`、`variants` 和 `options.headers`。
- 成本字段只有勾选“成本选项”时才校验和保存；`limit.context` 与 `limit.output` 必须成对填写。
- 删除模型、variant 或模型属性时，保存路径写入 `null` 删除哨兵，再由配置合并和 `stripNulls` 清理旧字段。
- 自动发现返回的 `contextLimit`、`outputLimit`、成本等字段先进入模型卡片。
- 精确命中的内置 catalog 默认值只补空字段、未开启能力或空 `variants`，不覆盖接口返回值或用户已填写值。
- 未命中精确默认值时显示最多 5 个候选模型，候选排序考虑 token 命中、覆盖度、顺序、尾缀、精确命中和前缀命中。
- 用户点击候选项后复制该候选模型的 `limit`、`modalities`、`reasoning`、`cost`、`variants`。
- 配置界面保持紧凑布局：`Provider API` 与 `BASE_URL` 在桌面宽度下并排显示。

关键文件：

| 范围 | 文件 | 说明 |
|---|---|---|
| Extension host | `packages/kilo-vscode/src/KiloProvider.ts` | 分发模型发现请求，带协议调用保存 key/env。 |
| Extension host | `packages/kilo-vscode/src/provider-actions.ts` | 保存 provider、刷新 catalog、处理 key/env、变体重置、失败回滚和删除哨兵。 |
| Shared helper | `packages/kilo-vscode/src/shared/custom-provider.ts` | 自定义 provider schema 与协议字段。 |
| Shared helper | `packages/kilo-vscode/src/shared/fetch-models.ts` | OpenAI / Anthropic / Gemini 模型发现。 |
| Shared helper | `packages/kilo-vscode/src/shared/provider-model.ts` | provider 协议推断、baseURL 规范化、默认值匹配入口。 |
| Webview UI | `CustomProviderDialog.tsx` | 表单、模型发现、默认值合并和候选列表。 |
| Webview UI | `CustomProviderDefaults.ts` | 默认参数匹配和候选排序。 |
| Webview UI | `CustomProviderModelCard.tsx` | 模型字段、能力、成本和 token limit 编辑。 |
| Webview UI | `CustomProviderValidation.ts` | 保存前校验。 |
| Webview UI | `CustomProviderVariants.ts` | reasoning variant 编辑。 |
| `opencode` 触点 | `packages/opencode/src/config/provider.ts` | 删除哨兵。 |
| `opencode` 触点 | `packages/opencode/src/provider/transform.ts` | provider transform 兼容。 |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/provider/{provider,transform}.ts` | Kilo 专属 provider transform。 |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/server/provider-auth-lifecycle.ts` | provider env/auth 顺序和模型缓存刷新。 |

### 模型列表过滤、排序与选择体验

| 功能 | 说明 |
|---|---|
| 模型列表过滤与排序 | 默认仅显示 Kilo Gateway 免费模型以及用户已添加或已连接提供商的模型，用户 provider 排在免费模型前面。 |
| 模型选择器交互 | 模型选择器默认折叠详情页，单击模型即可直接切换。 |
| 默认收藏 | 首次没有收藏记录时默认收藏 StepFun Step 3.7 Flash 免费模型，用户取消后不会自动恢复。 |

实际代码通过 `isVisibleModel` / `isModelValid` 统一模型可见性判断，并使用 `KILO_PROVIDER_ID` 判断 Kilo 官方 provider。

| provider | 规则 |
|---|---|
| `kilo` | 只保留 `model.isFree === true` 的免费模型。 |
| 已连接 provider | 保留该 provider 的全部模型。 |
| 未连接 provider | 不在可选模型列表显示。 |

注意事项：

- 不要用 `provider.source === "custom"` 判断用户自定义添加。models.dev 目录导入的普通 provider 也可能带 `source: "custom"`，会误放出未添加模型。
- 完整 catalog 会留在 webview 状态中。任何新入口如果直接渲染 `provider.models` 或只判断模型存在，都会绕过过滤。
- 新增模型展示、默认选择、历史选择、通知推荐、多模型选择、会话覆盖和 Agent Manager 新 worktree 创建等路径必须复用 `isVisibleModel` 或基于它的 `isModelValid`。
- 默认收藏通过 `FAVORITES_SEEDED_KEY` 控制：只有首次没有收藏记录时注入 StepFun Step 3.7 Flash 免费模型；用户清空后不会自动恢复。

关键文件：

| 范围 | 文件 | 说明 |
|---|---|---|
| 数据下发 | `packages/kilo-vscode/src/KiloProvider.ts` | 下发完整 provider catalog 和 connected provider 列表。 |
| 收藏清理 | `packages/kilo-vscode/src/provider-actions.ts` | 校验收藏模型并维护默认收藏初始化状态。 |
| 单一入口 | `packages/kilo-vscode/webview-ui/src/context/provider-utils.ts` | `isVisibleModel` / `isModelValid`。 |
| 会话状态 | `packages/kilo-vscode/webview-ui/src/context/session.tsx` | 防御不可见的会话覆盖、最近模型和 pending Kilo 模型。 |
| UI 入口 | `ModelSelector.tsx` / `MultiModelSelector.tsx` / `NewWorktreeDialog.tsx` | 主选择器、Agent Manager 多模型选择和 worktree 创建都复用可见性判断。 |

### 智能体中文化与隐藏 orchestrator

| 功能 | 说明 |
|---|---|
| 内置智能体中文说明 | 在设置页“智能体行为 > 代理”和聊天窗口智能体选择器中，`ask` / `code` / `debug` / `explore` / `general` / `plan` 显示中文说明。 |
| 隐藏 `orchestrator` | 在 VS Code 扩展的可选列表中隐藏内置 `orchestrator`；核心定义仍保留。 |

边界：只调整界面展示文案；用户自定义智能体不翻译，内部 `name` 和系统 `prompt` 不修改。

| 范围 | 处理 |
|---|---|
| `KiloProvider.fetchAndSendAgents()` | 后端返回 agents 后先调用 `filterAgents`，再生成 `agentsLoaded`。 |
| `filterVisibleAgents()` | 继续过滤 `subagent` 和 `hidden`，并防御性排除内置 `orchestrator`。 |
| `AgentBehaviourTab` | 从配置对象补充 agent 名称时，已知同名自定义 agent 保留；缺失定义的内置 `orchestrator` 仍按隐藏处理。 |
| `ModeSwitcher` | 使用 `agentLabel()` 和 `agentDescription()` 获取本地化展示。 |

关键文件集中在 `packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/src/kilo-provider-utils.ts`、`webview-ui/src/utils/agent-display.ts`、`ModeSwitcher.tsx`、`AgentBehaviourTab.tsx` 和三份 i18n 文件。

本功能没有修改 `packages/opencode/src/agent/agent.ts`、`packages/opencode/src/kilocode/agent/index.ts` 或 `packages/kilo-indexing/src/indexing/orchestrator.ts`。

## ZLF 身份维护

本仓库从 `itv3/kilo-code-plus` 的发布源码拆出，改为 `ZLF Code` / `itv3.zlfcode` 独立身份，目标是降低市场品牌混淆和审核风险。内部包名、命令 ID、配置 key、存储路径和 `packages/opencode/src/kilocode/` 边界尽量保持原样，避免扩大后续上游合并冲突。

需要保留的改名文件：

| 文件 | 作用 |
|---|---|
| `packages/kilo-vscode/package.json` | 扩展 ID、显示名、市场短描述、图标、仓库地址、分类和关键词。 |
| `packages/kilo-vscode/README.md` | VS Marketplace / Open VSX 的 Overview 正文。 |
| `packages/kilo-vscode/assets/icons/zlfcode.png` | 市场使用的独立图标。 |
| `packages/kilo-vscode/assets/icons/zlfcode-logo.svg` | 欢迎页和编辑器标签使用的黑底白字标识。 |
| `packages/kilo-vscode/assets/icons/zlfcode-activity.svg` | Activity Bar 使用的透明背景遮罩图标。 |
| `.github/workflows/publish-zlfcode.yml` | 构建、发布 VS Marketplace、发布 Open VSX、上传 GitHub Release。 |
| `.github/release-notes/zlfcode-v*.md` | ZLF 发布说明。 |
| `README.md` | 仓库首页、开发方案、发布流程和改名维护说明。 |

合并时不要全局替换的内容：

| 内容 | 原因 |
|---|---|
| `@kilocode/*` workspace 包名 | 大量内部依赖和构建脚本使用。 |
| `kilocode` 源码目录名 | 用于隔离 Kilo 自定义边界，减少上游冲突。 |
| VS Code command ID / configuration key | 改动会影响用户已有配置、快捷键和存储。 |
| CLI binary 名 `kilo` | 与当前构建、脚本和扩展启动路径绑定。 |
| 历史 changelog 里的上游项目名 | 属于历史来源说明，不影响市场首屏身份。 |

市场文案原则：

- 市场首屏短描述不使用上游项目名，避免看起来像官方变体。
- `packages/kilo-vscode/README.md` 顶部只描述 ZLF Code 的用途。
- 来源关系放在 README 靠后的“关系说明”中，明确写清非官方、自定义、不隶属、不背书。
- 如果后续更换图标，继续复用 `packages/kilo-vscode/assets/icons/zlfcode.png` 路径，减少 workflow 和 manifest 改动。

## 手动安装

如果暂时不通过扩展市场安装，可以直接下载 GitHub Release 中的 `.vsix` 文件后手动安装。Cursor 和 VS Code 的安装流程一样。

下载地址：`https://github.com/itv3/zlfcode/releases`

1. 从 GitHub Release 下载与你系统匹配的 `.vsix` 文件。
2. 打开 Cursor 或 VS Code。
3. 打开命令面板：Windows / Linux 按 `Ctrl+Shift+P`，macOS 按 `Cmd+Shift+P`。
4. 输入并执行 `Extensions: Install from VSIX...`，选择下载好的 `.vsix` 文件。
5. 安装完成后执行 `Developer: Reload Window`，或重启编辑器。

| 包名 | 对应环境 |
|---|---|
| `darwin-arm64` | macOS + Apple Silicon |
| `darwin-x64` | macOS + Intel |
| `win32-x64` | Windows + x86_64 |
| `win32-arm64` | Windows + ARM64 |
| `linux-x64` | Linux + x86_64 |
| `linux-arm64` | Linux + ARM64 |

## 发布与验证

自动发布 workflow：`.github/workflows/publish-zlfcode.yml`

推送 `zlfcode-v*` tag 后自动发布到：

- VS Marketplace：`https://marketplace.visualstudio.com/items?itemName=itv3.zlfcode`
- Open VSX：`https://open-vsx.org/extension/itv3/zlfcode`
- GitHub Release：`https://github.com/itv3/zlfcode/releases`

标准发布目标平台：`darwin-arm64`、`darwin-x64`、`win32-x64`、`win32-arm64`、`linux-x64`、`linux-arm64`。

```bash
git tag zlfcode-v7.4.1-v0.10
git push origin zlfcode-v7.4.1-v0.10
```

发布前必须准备 `.github/release-notes/zlfcode-v7.4.1-v0.10.md`，并确认根 `package.json.version` 与 `packages/kilo-vscode/package.json.version` 都是 `7.4.110`。

发布前检查：

```bash
rg -n "<<<<<<<|>>>>>>>|\\|\\|\\|\\|\\|\\|\\|" .
git diff --check
bun run script/check-workflows.ts
bun run script/check-opencode-annotations.ts --base refs/tags/v7.4.1

cd packages/kilo-vscode
bun test ./tests/unit/custom-provider-defaults.test.ts ./tests/unit/custom-provider-dialog-validate.test.ts ./tests/unit/custom-provider-variants.test.ts ./tests/unit/custom-provider-model-fetch.test.ts ./tests/unit/custom-provider.test.ts ./tests/unit/fetch-models.test.ts ./tests/unit/provider-actions-save.test.ts
bun test ./tests/unit/provider-actions-validate.test.ts ./tests/unit/i18n-keys.test.ts ./tests/unit/agent-display.test.ts ./tests/unit/kilo-provider-utils.test.ts ./tests/unit/model-selection.test.ts ./tests/unit/provider-utils.test.ts
bun run typecheck

cd ../opencode
bun test ./test/kilocode/custom-provider-delete.test.ts ./test/kilocode/provider-transform.test.ts ./test/kilocode/provider-variant-order.test.ts ./test/kilocode/server/provider-auth-lifecycle.test.ts
```

本地打包：

```bash
cd packages/kilo-vscode
bun run prepare:cli-binary -- --force
bun run rebuild-sdk
bun run typecheck
node esbuild.js --production
./node_modules/.bin/vsce package --no-dependencies --skip-license --target darwin-arm64 -o out/zlfcode-7.4.1-v0.10-darwin-arm64.vsix
```

安装到 Cursor 后验收：

| 项 | 期望 |
|---|---|
| 扩展详情页 | 显示 `ZLF Code` 和中文 ZLF 说明。 |
| 扩展版本 | 显示市场版本 `7.4.110`。 |
| 关于页面 | 版本信息不显示 `unknown`。 |
| 自定义 provider | OpenAI / Anthropic / Gemini 模型发现、保存、请求头、图片能力、推理能力、默认推理强度、token limit、成本选项、默认参数匹配和候选模型预览正常。 |
| 模型列表 | 只显示 Kilo Gateway 免费模型以及用户已添加或已连接 provider 的模型。 |
| 模型选择器 | 用户 provider 排在免费模型前面，默认折叠详情页，单击模型可直接切换。 |
| 默认收藏 | 首次没有收藏记录时注入 StepFun Step 3.7 Flash 免费模型，用户取消后不自动恢复。 |
| 智能体列表 | 内置智能体显示中文说明，`orchestrator` 不出现在可选列表。 |

自动测试不等于完整验收；发布前必须按上表在 Cursor 中人工逐项通过。

改名发布检查：

```bash
jq '.name, .displayName, .description, .publisher, .icon, .repository.url' packages/kilo-vscode/package.json
rg -n "Kilo Code Plus|kilo-code-plus|itv3\\.kilo-code-plus|logo-outline-black" packages/kilo-vscode/README.md packages/kilo-vscode/package.json .github/workflows
```

发布后检查：

```bash
npx --yes @vscode/vsce show --json itv3.zlfcode | jq '.publisher, .displayName, .extensionName, .versions[0].version'
curl -fsSL https://open-vsx.org/api/itv3/zlfcode/versions | jq .
```

## 上游升级范围

后续升级重点检查这些 ZLF 改动范围：

- 发布身份：`.github/workflows/publish-zlfcode.yml`、`.github/release-notes/zlfcode-v*.md`、`package.json`、`packages/kilo-vscode/package.json`、`packages/kilo-vscode/README.md`、`packages/kilo-vscode/assets/icons/zlfcode.png`。
- Extension host：`packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/src/provider-actions.ts`、`packages/kilo-vscode/src/kilo-provider-utils.ts`、`packages/kilo-vscode/src/shared/`。
- Webview UI：`packages/kilo-vscode/webview-ui/agent-manager/`、`packages/kilo-vscode/webview-ui/src/components/settings/CustomProvider*`、`ModeSwitcher.tsx`、`ModelSelector.tsx`、`provider-utils.ts`、`session.tsx`、`utils/agent-display.ts` 和 i18n 文件。
- `opencode` 触点：`packages/opencode/src/config/provider.ts`、`packages/opencode/src/provider/transform.ts`、`packages/opencode/src/server/routes/instance/httpapi/public.ts`、`packages/opencode/script/build.ts`。
- Kilo 边界与测试：`packages/opencode/src/kilocode/`、`packages/opencode/test/kilocode/`、`packages/kilo-vscode/tests/unit/custom-provider-*`、`provider-actions-*`、`model-selection.test.ts`、`provider-utils.test.ts`、`agent-display.test.ts`、`kilo-provider-utils.test.ts`。
- CI 与生成物：`script/check-opencode-annotations.ts`、`script/check-md-table-padding.ts`、`script/check-workflows.ts`、`packages/sdk/openapi.json`、`packages/sdk/js/src/v2/gen/types.gen.ts`。

## 关系说明

ZLF Code 是非官方自定义版本，不隶属于 Kilo Code，也不由 Kilo Code 官方维护或背书。

## 反馈

如果是上游 Kilo Code 本身的源码问题，请向上游反馈。如果是 ZLF 自定义提供商增强相关问题，请在本仓库反馈。
