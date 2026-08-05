# ZLF Code

ZLF Code 是面向内部使用的 AI coding agent。当前版本已接入官方 `v7.4.5` 历史，并在共同祖先基础上保留 ZLF 自定义功能、发布身份和 workflow。

## 当前版本

| 项 | 值 |
|---|---|
| 上游底座 | Kilo Code `v7.4.20` |
| ZLF 自定义版本 | `v0.01` |
| 发布批次 | `7.4.20-v0.01` |
| 市场版本 | `7.4.2001` |
| 扩展 ID | `itv3.zlfcode` |
| `publisher` | `itv3` |
| `name` | `zlfcode` |
| `displayName` | `ZLF Code` |
| VS Marketplace | `https://marketplace.visualstudio.com/items?itemName=itv3.zlfcode` |
| Open VSX | `https://open-vsx.org/extension/itv3/zlfcode` |
| GitHub 仓库 | `https://github.com/itv3/zlfcode` |

VS Marketplace / Open VSX 的 `package.json.version` 必须是普通 SemVer，所以市场页面显示 `7.4.2001`。GitHub tag、GitHub Release 和 VSIX 文件名使用发布批次 `7.4.20-v0.01`。发布批次 `A.B.C-v0.NN` 必须映射为市场版本 `A.B.CNN`，发布 workflow 会在构建前强制校验该映射、同步包版本、发布说明和当前版本文档。

## 维护原则

本轮升级通过双父节点合并提交接入官方 `v7.4.5` 历史，并在 `v7.4.1` 基线上三方应用上游增量。后续升级应直接以当前共同祖先合并新的官方 tag，继续保持 ZLF 补丁最小化。

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
| 启用 WebSocket | Provider API 选择 `OpenAI Responses` 时可为当前自定义 Provider 单独启用 WebSocket；默认关闭，连接失败时自动回退 HTTP。 |
| 模型自动发现 | 支持 OpenAI、Anthropic、Gemini，并自动处理 endpoint 和认证头。 |
| 自动发现交互优化 | 默认不全选，已添加模型不再显示，删除已添加模型后会重新拉取模型列表。 |
| 高级参数配置 | 支持配置图像输入能力、推理能力、`context token limit`、`output token limit`，以及输入、输出、缓存读取、缓存写入成本。 |
| 默认参数匹配 | 添加模型时按模型 ID 匹配内置默认参数，自动填充能力、成本和 token limit；也可选择候选模型应用其参数，并在保存前手动调整。 |
| 候选模型预览 | 候选模型支持 hover 预览，显示图片、推理、上下文/输出 token、成本和推理强度等默认参数。 |
| 配置界面增强 | 优化自定义提供商配置界面布局、提示语和参数命名，减少表单高度。 |
| 设置主页精简 | 移除上游设置主页的 Popular providers 快捷连接区块，让设置主页聚焦自定义 Provider 管理；热门 provider 经「Add provider」弹窗仍可连接，并在弹窗中按推荐分组置顶。 |
| Provider 热更新 | 新增、修改或删除自定义 Provider 模型后，无需重启后端即可在所有活动工作区和聊天界面使用最新配置。 |

关键实现：

- 模型发现支持四类包名到三种协议的映射：

| `form.npm` | 协议 | 发现规则 |
|---|---|---|
| `@ai-sdk/openai-compatible` / `@ai-sdk/openai` | `openai` | 保持用户 `baseURL`，发现时拼 `/models` 并使用 Bearer key。 |
| `@ai-sdk/anthropic` | `anthropic` | 自动补到 `/v1`，发现时拼 `/models` 并使用 `x-api-key`。 |
| `@ai-sdk/google` | `gemini` | 自动补到 `/v1beta`，发现时拼 `/models` 并使用 Gemini key。 |

- 编辑已有 provider 时，webview 不接收已保存的 API key。扩展端只在 providerID、发现协议和规范化后的 `baseURL` 都匹配时，才复用已保存 key 或 `{env:VAR}`；内置 `openai` / `anthropic` / `google` provider ID 不进入这份缓存。
- 自定义 Provider 选择 `@ai-sdk/openai` 时，API key 同一行显示“启用 WebSocket”；勾选后保存为当前 Provider 的 `options.websocket: true`，不依赖进程级 `KILO_EXPERIMENTAL_WEBSOCKETS`。
- WebSocket 只接管带 session affinity 的流式 `/v1/responses` 请求；标题生成、非流式请求和其他 endpoint 继续使用 HTTP，连接失败时沿用内置重试与 HTTP 回退策略。内置 `openai` Provider 仍保留原有环境变量开关，避免重复注入 transport。
- 模型卡片保存字段覆盖 `modalities`、`reasoning`、`limit.context`、`limit.output`、`cost`、`variants` 和 `options.headers`。
- 成本字段只有勾选“成本选项”时才校验和保存；`limit.context` 与 `limit.output` 必须成对填写。
- 删除模型、variant 或模型属性时，保存路径写入 `null` 删除哨兵，再由配置合并和 `stripNulls` 清理旧字段。
- 自动发现返回的 `contextLimit`、`outputLimit`、成本等字段先进入模型卡片。
- 精确命中的内置 catalog 默认值只补空字段、未开启能力或空 `variants`，不覆盖接口返回值或用户已填写值。
- 未命中精确默认值时显示最多 5 个候选模型，候选排序考虑 token 命中、覆盖度、顺序、尾缀、精确命中和前缀命中。
- 用户点击候选项后，候选模型的能力、token limit、成本和完整 `variants` 会覆盖自动匹配的默认参数；之后仍可手动调整，并以保存时的表单值为准。
- 配置界面保持紧凑布局：`Provider API` 与 `BASE_URL` 在桌面宽度下并排显示。
- 设置主页移除上游 Popular providers 快捷连接区块（含备注文案与一键 Connect），这是有意的 UI 决策：设置主页聚焦自定义 Provider 入口并压缩页面高度。热门 provider 的可达性不受影响——「Add provider」打开的 `ProviderSelectDialog` 仍提供完整 provider 目录，且热门 provider 经 `popularProviderIndex` 按推荐分组（`settings.providers.group.recommended`）置顶展示。该决策由 `tests/unit/providers-tab-source.test.ts` 锁定；`provider-catalog.ts` 中上游导出的 `providerNoteKey` 依维护原则第 5 条保留为兼容壳，不随区块移除删除。

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
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/provider/openai-websocket.ts` | 将自定义 Provider 的配置开关转换为 Responses WebSocket transport。 |
| `opencode` 触点 | `packages/opencode/src/config/provider.ts` | 删除哨兵。 |
| `opencode` 触点 | `packages/opencode/src/provider/transform.ts` | provider transform 兼容。 |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/provider/{provider,transform}.ts` | Kilo 专属 provider transform。 |
| `opencode` Kilo 边界 | `packages/opencode/src/kilocode/server/provider-auth-lifecycle.ts` | provider env/auth 顺序和模型缓存刷新。 |

### 自定义 Provider 配置热更新

自定义 Provider 配置通过设置页保存或直接修改全局配置后，运行时注册表必须在不重启 Kilo 后端的情况下更新。新增、修改和删除模型时只原子替换发生变化的自定义 Provider，避免重建全部 Provider 和模型目录。

关键行为：

- `Provider.getModel()`、Provider 列表和语言模型加载在读取缓存前检查最新配置快照，保证新模型能够立即使用，已删除模型不会残留。
- 一次全局配置保存会刷新所有已活动工作区实例；项目配置更新只刷新对应工作区。
- 目标 Provider 更新时精确清理语言模型、SDK、WebSocket transport 和 loader 缓存，保留其他 Provider 的认证、SDK、语言模型实例和运行时状态。
- 每个 Provider 维护独立 version，配置更新前启动的异步 SDK 或语言模型加载不能回写新缓存。
- 配置快照通过信号量串行应用，连续快速保存以后一次配置为准。
- 设置页保存以配置 PATCH 成功为完成条件，不阻塞等待远端模型目录或 `/provider/ready`；模型目录使用缓存复用、single-flight 和后台刷新。
- Extension host 为 Provider 状态分配单调 revision，并向所有活动 Webview 发布同一份增量结果；Webview 拒绝迟到的旧快照。
- 删除当前模型后，聊天界面立即回退到有效模型；重新添加后可立即选择并发送。
- 自定义 Provider 认证明确区分 `preserve`、`set` 和 `clear`，普通模型编辑不会清除已有 API key。
- 候选 catalog 晚到后会自动重新计算；候选参数和默认推理强度在当前表单中立即生效。

关键文件：

| 范围 | 文件 | 说明 |
|---|---|---|
| Core refresh | `packages/core/src/kilocode/models-refresh.ts` | 向所有活动实例发布模型刷新通知。 |
| Provider refresh | `packages/opencode/src/kilocode/provider/config-refresh.ts` | 比较配置快照并精确刷新变化的自定义 Provider。 |
| Provider readiness | `packages/opencode/src/kilocode/provider/ready.ts` | 检查目标 Provider 的运行时模型集合，不实例化模型 SDK。 |
| Provider registry | `packages/opencode/src/provider/provider.ts` | 读取前同步配置，维护 Provider version 并防止旧异步缓存回写。 |
| Model catalog cache | `packages/opencode/src/provider/model-cache.ts` | 模型目录 single-flight、缓存复用和后台刷新。 |
| HTTP API | `packages/opencode/src/kilocode/server/httpapi/groups/provider-ready.ts` | 定义 `/provider/ready` 诊断接口。 |
| Extension state | `packages/kilo-vscode/src/KiloProvider.ts` | 维护 Provider revision、共享认证缓存和多 Webview 状态发布。 |
| Provider actions | `packages/kilo-vscode/src/provider-actions.ts` | 保存后发布精确 Provider 状态，不阻塞等待 catalog 刷新。 |
| Webview state | `packages/kilo-vscode/webview-ui/src/context/provider.tsx` | 合并增量状态并拒绝迟到 revision。 |

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
| 数据下发 | `packages/kilo-vscode/src/KiloProvider.ts` | 分别下发 connected/catalog 快照和带 revision 的增量 Provider 状态。 |
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
git tag zlfcode-v7.4.20-v0.01
git push origin zlfcode-v7.4.20-v0.01
```

发布前必须准备 `.github/release-notes/zlfcode-v7.4.20-v0.01.md`，并确认所有同步包版本都是 `7.4.2001`。运行以下校验可在打标签前检查版本映射、同步包、发布说明和文档：

```bash
bun run script/zlfcode/check-release.ts zlfcode-v7.4.20-v0.01
```

发布前检查：

```bash
rg -n "<<<<<<<|>>>>>>>|\\|\\|\\|\\|\\|\\|\\|" .
git diff --check
bun run script/check-workflows.ts
bun run script/check-opencode-annotations.ts --base refs/tags/v7.4.5

cd packages/kilo-vscode
bun test ./tests/unit/custom-provider-defaults.test.ts ./tests/unit/custom-provider-dialog-validate.test.ts ./tests/unit/custom-provider-variants.test.ts ./tests/unit/custom-provider-model-fetch.test.ts ./tests/unit/custom-provider.test.ts ./tests/unit/fetch-models.test.ts ./tests/unit/provider-actions-save.test.ts
bun test ./tests/unit/provider-actions-validate.test.ts ./tests/unit/i18n-keys.test.ts ./tests/unit/agent-display.test.ts ./tests/unit/kilo-provider-utils.test.ts ./tests/unit/model-selection.test.ts ./tests/unit/provider-utils.test.ts
bun run typecheck
bun run lint

cd ../opencode
bun test ./test/kilocode/custom-provider-delete.test.ts ./test/kilocode/provider-transform.test.ts ./test/kilocode/provider-variant-order.test.ts ./test/kilocode/server/provider-auth-lifecycle.test.ts ./test/kilocode/provider-config-refresh.test.ts ./test/kilocode/model-cache-effect.test.ts

cd ../core
bun test ./test/kilocode/models-refresh.test.ts
```

本地打包：

```bash
cd packages/kilo-vscode
bun run prepare:cli-binary -- --force
bun run rebuild-sdk
bun run typecheck
node esbuild.js --production
./node_modules/.bin/vsce package --no-dependencies --skip-license --target darwin-arm64 -o out/zlfcode-7.4.20-v0.01-darwin-arm64.vsix
```

安装到 Cursor 后验收：

| 项 | 期望 |
|---|---|
| 扩展详情页 | 显示 `ZLF Code` 和中文 ZLF 说明。 |
| 扩展版本 | 显示市场版本 `7.4.2001`。 |
| 关于页面 | 版本信息不显示 `unknown`。 |
| 自定义 provider | OpenAI / Anthropic / Gemini 模型发现、保存、请求头、图片能力、推理能力、默认推理强度、token limit、成本选项和候选模型预览正常；选择候选模型会覆盖自动默认参数并保留后续手动调整。 |
| 启用 WebSocket | 自定义 Provider 选择 `OpenAI Responses` 后显示 WebSocket 开关；开启并保存后流式对话使用 WebSocket，标题请求使用 HTTP，WebSocket 失败时可回退 HTTP；关闭后恢复纯 HTTP。 |
| Provider 热更新 | 后端启动后给已有自定义 Provider 新增模型，保存后无需重启即可选择并发送；删除后模型立即从聊天选择器消失；重新添加后可立即发送。 |
| 多 Webview 同步 | 同时打开聊天和设置页，Provider 模型变化在两个界面同步，迟到快照不会恢复已删除模型。 |
| 默认推理强度 | 候选参数带入后选择 `Max`，当前选择框立即显示 `Max`；保存退出后重新进入仍显示 `Max`。 |
| 认证保留 | 编辑模型但不填写 API key 时，已有认证保持不变。 |
| 快速连续保存 | 连续新增、修改和删除模型后，最终界面与运行时注册表都对应最后一次保存。 |
| 多工作区实例 | 修改全局自定义 Provider 后，所有已活动工作区实例都能使用最新模型集合。 |
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
- `opencode` 触点：`packages/opencode/src/config/provider.ts`、`packages/opencode/src/provider/{provider,model-cache,transform}.ts`、`packages/opencode/src/server/routes/instance/httpapi/{api,public}.ts`、`packages/opencode/script/build.ts`。
- Kilo 边界与测试：`packages/opencode/src/kilocode/`、`packages/opencode/test/kilocode/`、`packages/kilo-vscode/tests/unit/custom-provider-*`、`provider-actions-*`、`model-selection.test.ts`、`provider-utils.test.ts`、`agent-display.test.ts`、`kilo-provider-utils.test.ts`。
- CI 与生成物：`script/check-opencode-annotations.ts`、`script/check-md-table-padding.ts`、`script/check-workflows.ts`、`packages/sdk/openapi.json`、`packages/sdk/js/src/v2/gen/types.gen.ts`。

## 关系说明

ZLF Code 是非官方自定义版本，不隶属于 Kilo Code，也不由 Kilo Code 官方维护或背书。

## 反馈

如果是上游 Kilo Code 本身的源码问题，请向上游反馈。如果是 ZLF 自定义提供商增强相关问题，请在本仓库反馈。
