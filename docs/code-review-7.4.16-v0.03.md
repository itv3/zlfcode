# ZLF Code 7.4.16-v0.03 代码审核报告

审核对象：ZLF Code 相对上游 Kilo Code `v7.4.16` 的全部修改（`git diff v7.4.16..HEAD`，251 个文件，约 +12510/-2607 行）。
审核日期：2026-07-29。

## 审核方法

按 8 个功能域并行审读（扩展宿主 Provider 状态、协议推断与模型发现、自定义 Provider 表单 UI、opencode Kilo 边界热更新与 WebSocket、上游共享文件触点、模型可见性与选择器、智能体中文化、连接层与其他未记载改动），每个域对照三个维度：

1. 最小入侵原则与架构合理性（含是否有更优实现方案）；
2. 代码质量；
3. 对增强功能之外上游原有功能的回归影响。

审读产出 59 条发现；其中全部中/高级别发现（21 条）由独立的对抗性验证轮到代码中逐条证伪，**无一被驳回**（4 条降级、1 条升级），验证理由附在各条目末尾。低级别发现未单独验证。

## 统计与总体结论

| 级别（验证修正后） | 数量 | 编号 |
|---|---|---|
| 高危 | 2 | F01–F02 |
| 中等 | 13 | F03–F15 |
| 低 | 44 | F16–F59 |

整体工程质量明显高于同类 fork 平均水准：核心增强的并发设计自洽、测试覆盖充分、改动基本收敛在 `packages/kilo-vscode` 与 `packages/opencode/src/kilocode/` 边界内。高危与中等问题集中在两处 README 未充分记载的改动：webview 侧持久化清理逻辑（F02）与共享 CLI 后端生命周期（F13–F15）；上游触点的语义变化（F06–F09）是回归风险最高的区域。

说明：F27 与 F50 为同一问题（删除上游 Popular providers 区块）在两个审读域的独立报告，合并处理。

## 处理结果统计

2026-07-29 完成全部 59 条的处理：**53 条已修复、3 条保守处理（F15、F20、F52）、3 条接受现状（F33、F34、F49）、0 条未完成**。每条的处理记录、修改文件与测试结果见各条目"处理状态"字段。

## 全量验证记录（2026-07-29，修复完成后）

| 检查项 | 结果 |
|---|---|
| 合并冲突标记扫描 | 通过 |
| `git diff --check` | 通过（`packages/tui/src/kilocode/session-mentions.ts` 的 EOF 空行为 F59 恢复上游原样所致，该文件现与 `v7.4.16` 逐字节一致，提交后即无告警） |
| `bun run script/check-workflows.ts` | 通过（29 workflows） |
| `bun run script/check-opencode-annotations.ts --base refs/tags/v7.4.5` | 通过 |
| `bun run script/check-md-table-padding.ts` | 通过（391 文件） |
| kilo-vscode `bun run typecheck`（扩展宿主 + webview） | 通过 |
| kilo-vscode 全量单元测试（含 `connection-service.test.ts`） | 3554 通过 / 1 失败——唯一失败为 `worktree-manager.test.ts` 的 `returns bare branch + remote when remote exists`，需真实 git fetch 的既有环境失败；已用 `git stash` 在未含本次修复的基线上复现同样失败，确认与本次修复无关 |
| opencode 相关测试（13 个文件：热更新、编译对拍、model-cache、生命周期、auth、WebSocket、shutdown、watchdog、provider 等） | 167 通过 / 0 失败 |
| opencode `tsc --noEmit` | 通过（过程中修正了 F01 新增测试的一处类型转换写法） |
| core 测试（`models-refresh`、`config.test.ts`） | 16 通过 / 0 失败 |
| `script/zlfcode/check-release.test.ts` 与 `check-release.ts zlfcode-v7.4.16-v0.03` 实跑 | 通过 |

说明：自动测试不等于完整验收；README 验收表中的 Cursor 人工逐项验证（模型发现、WebSocket 开关、热更新、多 Webview 同步等）仍需在下次发布前人工执行，特别注意本次行为有调整的路径：收藏不再被自动删除（F02）、设置页对不可用配置模型显示原始值（F11）、非 provider 配置 PATCH 恢复实例销毁语义（F06）、共享后端假阳性保护与重启退避（F13/F14）。

## 处理状态图例

- **已修复**：代码已修改并通过相关测试。
- **保守处理**：完整修复风险过大（大型架构重构），已做低风险的缓解性修复，剩余部分在本文档记载。
- **接受现状**：确认为有意取舍或修复弊大于利，理由在条目处理状态中说明。

---

# 发现明细

### F01【高危/回归】waitForServer 无条件 ppid 孤儿检测会终止手动后台运行的 kilo serve

- **域**：upstream-touch
- **位置**：`packages/opencode/src/kilocode/cli/shutdown.ts:58`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：按审核建议将 waitForServer 的孤儿检测统一收敛到 parent-watchdog：1) shutdown.ts 删除自建的无门控 orphaned() 每秒轮询，改为调用 startParentWatchdog——该函数自带 KILO_PARENT_PID 门控（未设置或非法 PID 时直接返回空函数，不启动任何定时器），判定逻辑与 parent-watchdog 完全一致（含 EPERM 视为存活的处理，比原自建版本更稳健）；stop() 中同步清理 watchdog；为便于测试新增可选参数 options.watchdogIntervalMs（默认仍为 parent-watchdog 的 1000ms）。2) serve.ts 移除独立的 startParentWatchdog 调用及其 import，消除两套重复孤儿检测与双重停机竞争，改动全部位于既有 kilocode_change 标记块内，未触碰上游其他代码。3) 新增 2 个测试：无 KILO_PARENT_PID 时把 process.ppid 临时覆盖为 1（模拟 nohup/disown 后父 shell 退出被重新父化），等待远超轮询间隔后确认不停机、随后 SIGTERM 信号路径仍正常优雅停机；设置 KILO_PARENT_PID 指向已确认死亡的真实 PID（spawn 后 SIGKILL 并等待回收）时，孤儿检测触发 server.stop(true) 与 disposeAllInstances。测试日志亦证实无门控场景下 watchdog 从未启动。

**修改文件**：`packages/opencode/src/kilocode/cli/shutdown.ts`、`packages/opencode/src/cli/cmd/serve.ts`、`packages/opencode/test/kilocode/cli-shutdown.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/cli-shutdown.test.ts → 4 pass / 0 fail（含既有 2 个 telemetry 顺序测试）；bun test test/kilocode/parent-watchdog.test.ts → 3 pass / 0 fail（确认复用方未受影响）

**问题描述**：serve.ts 现在通过 KiloShutdown.waitForServer 等待退出，其中每秒轮询 process.ppid：只要与启动时的父进程不一致（或父进程消失）就触发优雅停机。上游行为是仅在设置 KILO_PARENT_PID 时才做父进程监控，parent-watchdog.ts 的注释明确写着"手动启动的 kilo serve（父 shell 退出可能是有意的）永不受影响"。新逻辑没有任何门控：用户 nohup/disown 方式后台启动 kilo serve 后 shell 一退出，ppid 变为 1，服务器约 1 秒内自行关停。这直接破坏了上游支持的 headless/守护化用法，且与同文件中仍在运行的 startParentWatchdog 形成两套重复的孤儿检测。

**修复建议**：为 waitForServer 的 ppid 轮询加与 parent-watchdog 相同的 KILO_PARENT_PID 门控（或复用 startParentWatchdog 的 orphaned 实现），未设置该环境变量时只监听信号；同时消除与 parent-watchdog.ts 重复的 orphaned 逻辑。

**验证结论**：核实属实。shutdown.ts:17-29 中 orphaned() 以启动时的 process.ppid 为基准，第 20 行 `if (process.ppid !== parent) return true` 无任何环境变量门控；serve.ts:34 无条件进入 waitForServer，第 58-61 行每秒轮询。用户以 `nohup kilo serve &` 启动后 shell 退出，进程被重新父化（ppid 变为 1），与启动时 parent 不等即触发 stop()，约 1 秒内 disposeAllInstances + server.stop。对照 parent-watchdog.ts:14-15 的注释「No-op unless KILO_PARENT_PID is set... a manually launched kilo serve is never affected」以及 v7.4.16 基线的 serve.ts（仅信号监听 + 有门控的 startParentWatchdog，无 ppid 轮询），这是明确的行为回归。serve.ts:33-34 同时运行有门控的 startParentWatchdog 与无门控的 waitForServer 轮询，孤儿检测逻辑重复的描述也属实。该逻辑由 51fa5f9329 引入且无测试覆盖此场景（cli-shutdown.test.ts 只测 telemetry 顺序）。serve 是公开 CLI 命令（描述即 starts a headless kilo server），守护化用法被完全破坏，high 级别合理。


### F02【高危/回归】createStaleModelPruner 在 provider 瞬时缺失或用户主动断开时永久删除收藏、最近模型和 per-agent 选择

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/src/context/session-model-prune.ts:64`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：整体移除 createStaleModelPruner 及其接线。评估结论：pruner 的持久删除副作用（toggleFavorite remove / clearModelSelection / persistRecents）是高危缺陷本体；其内存态清理同样与"数据仅隐藏、provider 恢复后复活"的上游语义相悖（删除内存条目会导致重连后用户选择无法恢复），且读取与展示路径已完整过滤失效条目（resolveModelSelection 全链 validate、sessionModel/validModel 防御、ModelSelector 与 visibleModels 交集展示），pruner 不承担任何必要职责。故删除 session.tsx 中的接线（原处保留详细中文注释说明历史行为、三种误删路径与移除理由），并删除 fork 新增文件 session-model-prune.ts（提交 7fbcfa4dd4 新增，已确认全仓库唯一引用为 session.tsx，非上游导出符号，不违反不删上游导出原则）。用户手动取消收藏（session.tsx toggleFavorite）与用户主动清除 per-agent 选择（clearModelSelection persist 路径）等合法持久化路径不受影响。新增 tests/unit/stale-model-retention.test.ts 锁定新行为：(1) 用户断开 provider（connected 移除、providers 保留，对应 removed=false）后读取路径回退且 store 数据逐字段保持原样；(2) 重连后既有选择自动恢复生效；(3) kilo 缺失的过渡快照下 kilo 免费模型判定暂不可用但数据保留、kilo 恢复后复活；(4) providers 为空的启动窗口豁免校验；(5) 源码守卫断言 session-model-prune.ts 已删除且 webview 全部源码不再引用 createStaleModelPruner，防止 pruner 被重新接线。

**修改文件**：`packages/kilo-vscode/webview-ui/src/context/session.tsx`、`packages/kilo-vscode/webview-ui/src/context/session-model-prune.ts`、`packages/kilo-vscode/tests/unit/stale-model-retention.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/stale-model-retention.test.ts tests/unit/provider-utils.test.ts tests/unit/session-model-store.test.ts tests/unit/session-preferences.test.ts tests/unit/model-selection.test.ts → 63 pass / 0 fail；关联回归 bun test tests/unit/agent-manager-arch.test.ts tests/unit/kilo-provider-session-refresh.test.ts tests/unit/kilo-provider-utils.test.ts tests/unit/kilo-provider-worktree-context.test.ts tests/unit/message-contract.test.ts tests/unit/new-worktree-dialog-sandbox.test.ts tests/unit/prompt-input-bidirectional.test.ts tests/unit/prompt-send-contract.test.ts tests/unit/provider-context.test.ts tests/unit/session-select-connection.test.ts tests/unit/sandbox-bootstrap.test.ts tests/unit/indexing-utils.test.ts tests/unit/sameDirectory.test.ts → 260 pass / 0 fail

**问题描述**：pruner effect 对所有 isModelValid 为 false 的条目执行持久化删除：对 favorites 发 toggleFavorite remove（KiloProvider.saveFavorites 会同时置位 FAVORITES_SEEDED_KEY，之后默认收藏永不重新注入）、对 per-agent 选择发 clearModelSelection 写入 model.json、对 recents 发 persistRecents。触发条件仅为 providers() 非空且条目不可见，存在多个非预期触发路径：(a) 用户在设置页断开内置 provider（provider-actions.ts 的 disconnect 发 providerDisconnected removed=false），该 provider 的全部收藏与记录被永久删除，重连后不恢复——上游行为是仅隐藏、数据保留；(b) 扩展端 KiloProvider.fetchAndSendProviders 在 kilo provider 缺失（如离线、gateway 拉取失败）时仍无条件 postMessage 不含 kilo 的 connected 快照、仅 scheduleProviderRetry，此窗口内所有 kilo 免费模型收藏（含默认收藏 StepFun）被永久 remove 并通过 notifyFavoritesChanged 广播到所有窗口；(c) 后端重启期间 SSE 重连触发 refreshConnectionData 拉到的过渡快照同理。而读取路径（resolveModelSelection 全链 validate、ModelSelector 的 favoriteModels 与 visibleModels 交集展示、session.tsx 的 sessionModel 回退）已经完整过滤，持久删除的实际收益接近零。

**修复建议**：将 pruner 改为仅内存过滤（sessionOverrides 已由 sessionModel() 读取时防御，favorites/recents 已由展示与 resolve 路径过滤，可完全去掉持久删除副作用）；确需清理存储时，把清理移到扩展端，仅在确认 provider 配置被真正删除（removed=true）且模型确实不存在于该 provider 时执行，并对 kilo provider 缺失的快照（expectsKiloProvider 且 missing）跳过清理。

**验证结论**：逐条核实全部成立，未找到反证。(1) 触发条件与副作用属实：session-model-prune.ts:26 仅以 providers() 非空为 gate，第 66-70 行对 stale 条目发 clearModelSelection（写 model.json）、persistRecents 和 toggleFavorite remove；KiloProvider.ts:2532-2534 saveFavorites 持久化并置位 FAVORITES_SEEDED_KEY，provider-actions.ts:393-398 resolveFavorites 在 seeded=true 后永不重注默认收藏（DEFAULT_FAVORITES 为 kilo/stepfun/step-3.7-flash:free，provider-actions.ts:33），KiloProvider.ts:2548 notifyFavoritesChanged 跨窗口广播。(2) 路径 a 属实：disconnectProvider（provider-actions.ts:726-729）对内置 provider 发 providerDisconnected removed=false；provider.tsx applyProviderMessage 第 171-181 行在 removed=false 时保留 providers、仅从 connected 移除，而 provider-utils.ts:41 isVisibleModel 要求 connected.includes → 该 provider 全部收藏/最近/选择立即 stale 并被持久删除；上游 v7.4.16 无此 pruner（session-model-prune.ts 为 7fbcfa4dd4 新增文件），上游 ModelSelector.tsx:252-258 仅以 visibleModels 交集隐藏收藏、数据保留。(3) 路径 b 属实：KiloProvider.ts fetchAndSendProviders 中 postMessage(message)（约 2410 行）先于 missing 检查（2413-2415 行 expectsKiloProvider && !response.all.some(id===KILO) 则 scheduleProviderRetry）——作者自知 kilo 可能瞬时缺失并安排重试，但缺失快照仍先行发送；webview applyProviderMessage 第 133 行仅拒绝 revision 回退，过渡快照会全量替换 providers，provider-utils.ts:58-59 provider 缺失即 invalid → kilo 全部免费收藏被删。仅『离线』一词略不精确（client 为 null 或 fetch 抛异常时不发新快照，走 cachedProvidersMessage/重试），但不影响核心结论。(4) 路径 c 属实：KiloProvider.ts:1635/1721 SSE connected 后 refreshConnectionData → fetchAndSendProviders，同样经过路径 b 的窗口。(5) 『读取路径已完整过滤、持久删除收益近零』属实：model-selection.ts:36-38 对 override/mode/global/recent 全链 validate，session.tsx:603-608 sessionModel 有 validModel 防御，ModelSelector.tsx:279-287 收藏展示与 visibleModels 交集。pruner 无任何单测覆盖。永久性用户数据丢失且跨窗口传播、无法自动恢复，high 恰当。


### F03【中等/缺陷】Anthropic 与 Gemini 模型发现未处理分页，默认页大小会漏模型

- **域**：shared-helpers
- **位置**：`packages/kilo-vscode/src/shared/fetch-models.ts:204`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：fetch-models.ts 实现完整分页：fetchAnthropicModels 每页显式请求 limit=1000 并按 has_more/last_id 以 after_id 游标循环合并；fetchGeminiModels 每页请求 pageSize=1000 并跟随 nextPageToken 循环。加入 MAX_FETCH_PAGES=10 最大页数保护，另对游标不推进（last_id 重复 / nextPageToken 不变）的异常 endpoint 立即终止，防止死循环。沿用每请求 15s 超时；2MB 响应上限改为通过共享 ByteBudget 在整个分页流程内按累计字节数生效（单次调用默认预算不变，既有单页超限行为保持一致）。

**修改文件**：`packages/kilo-vscode/src/shared/fetch-models.ts`、`packages/kilo-vscode/tests/unit/fetch-models.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/fetch-models.test.ts：19 pass 0 fail。新增用例覆盖 Anthropic 双页合并与 limit=1000 参数、10 页封顶、游标停滞即停、Gemini nextPageToken 双页合并与 pageSize=1000、10 页封顶、跨页累计 2MB 上限（第二页触发 Model response is too large）。

**问题描述**：fetchAnthropicModels 直接 GET {baseURL}/v1/models 且不带 limit 参数，Anthropic API 默认每页仅返回 20 条并通过 has_more/last_id 分页，当前 Anthropic 官方模型（含日期快照）已超过 20 条，自动发现会静默漏掉后半部分模型；fetchGeminiModels（第 234 行）同样不带 pageSize 也不跟随 nextPageToken，Gemini /v1beta/models 默认 pageSize=50，官方目录条目已超过 50 条。用户在自动发现列表中找不到部分真实存在的模型，且无任何提示。

**修复建议**：最小修复：Anthropic 请求追加 ?limit=1000（API 上限），Gemini 请求追加 ?pageSize=1000；更完整的做法是在 request 层按 has_more/last_id 与 nextPageToken 循环拉取并合并结果（配合现有 15s 超时与 2MB 累计上限）。

**验证结论**：代码层面完全属实：packages/kilo-vscode/src/shared/fetch-models.ts 中 request()（第 131-152 行）仅发起一次 GET，fetchAnthropicModels（第 204-232 行）经 anthropicModelsURL（第 169-173 行）构造的 URL 不带 limit 参数，也不读取响应的 has_more/last_id；fetchGeminiModels（第 234-262 行）拼接 /models 不带 pageSize，也不跟随 nextPageToken。该文件为 fork 新增（提交 63171e23ad），调用方 KiloProvider.ts 第 2558-2578 行直接将结果发给 webview，tests/unit/fetch-models.test.ts 亦无分页覆盖，不存在其他代码兜底。Anthropic 官方文档确认 /v1/models 的 limit 'Defaults to 20. Ranges from 1 to 1000'，以 has_more/first_id/last_id 分页；Gemini 官方文档确认 pageSize 'If unspecified, 50 models will be returned per page'，以 nextPageToken 分页——审核员对两个 API 分页机制的描述均准确，溢出时确为静默截断且无任何提示。但描述中两处即时影响的数量断言需要修正：其一，'当前 Anthropic 官方模型已超过 20 条'不成立——官方 models overview 与弃用页显示普通组织当前可返回的条目约 14-16 条（fable-5、opus-5、sonnet-5、haiku-4-5-20251001、opus-4-8/4-7/4-6、sonnet-4-6、sonnet-4-5-20250929、opus-4-5-20251101、opus-4-1-20250805、sonnet-4/opus-4-20250514、claude-3-haiku-20240307 等），未超过默认页 20，当前对官方 Anthropic 端点并不会漏；其二，'Gemini 官方目录已超过 50 条'未能确证——2025-03-31 的完整快照实测为 42 条（无 nextPageToken），此后 Google 密集新增 2.5 全系/3 系/3.1 系等条目而较少移除，当前大概率处于临界或已超限，但无法在无 API key 的情况下实测。综合：缺陷本体（未按文档实现分页、溢出静默漏项）真实存在且为时间炸弹式隐患（Gemini 侧临界、模型目录只增不减、第三方 Anthropic/Gemini 兼容网关目录可任意大），建议的最小修复（追加 limit=1000 / pageSize=1000）正确且成本极低，故判 CONFIRMED；考虑到自动发现失败时用户仍可手动输入模型 ID 作为规避，medium 处于合理区间上沿，予以保留。


### F04【中等/缺陷】fill() 逐键精确匹配会残留错误模型的默认参数

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx:526`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：按推荐方案实现自动填充来源记录与回收：在 CustomProviderDefaults.ts 下沉纯函数 autoFillModel（基于 mergeModelDefaults 合并并记录本次实际写入的字段快照）、revertAutoFill（精确命中失效或命中目标变化时，用结构化深比较识别仍等于自动填充值的字段并恢复为空值，用户手改过的值保留；深比较是必需的，因为写入 Solid store 后读出的是 proxy 包装，引用比较会失效）、stripReasoningDefaults（剥离 reasoning/variants 默认值）。CustomProviderDialog.tsx 中：fill() 每次 ID 变化先检查 autoFill 记录（record.id !== id 即回收），解决验证结论指出的两个问题——途经前缀命中（如输入 glm-5.2-max 途经 glm-5.2）的残留参数会被回收，回收后最终 ID 的正确默认值也能正常写入；新增 reasoningDeclined 集合追踪用户显式取消 reasoning 的行，apply 时经 stripReasoningDefaults 剥离，不再强制勾回（用户重新勾选、选择变体或点击候选时清除标记）；行删除/替换时通过 shiftRowState 迁移行级局部状态。保持了'精确命中默认值只补空字段'的 README 语义，既有 mergeModelDefaults 测试全部原样通过。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDefaults.ts`、`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx`、`packages/kilo-vscode/tests/unit/custom-provider-defaults.test.ts`、`packages/kilo-vscode/tests/unit/custom-provider-dialog-source.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/custom-provider-defaults.test.ts tests/unit/custom-provider-dialog-validate.test.ts tests/unit/custom-provider-variants.test.ts tests/unit/custom-provider-dialog-source.test.ts → 69 pass 0 fail（新增 7 个纯函数测试覆盖填充记录、前缀命中回收、手改保留、store proxy 结构比较、reasoning 不强制勾回、错误键计算）；bun x tsc --noEmit --project webview-ui/tsconfig.json 通过

**问题描述**：onChangeId 每次按键都调用 fill() → defaultsForModel 精确匹配并 apply()。当目标 ID 的某个前缀本身是完整 catalog ID 时（例如输入 glm-5.2-max 途经 glm-5.2），中途命中会把 glm-5.2 的成本、context/output limit、variants、reasoning 写入表单；用户继续输入后最终 ID 不再命中，这些来自错误模型的参数仍留在表单里并可被静默保存（apply 只补空字段，不会随命中失效而回收）。同理，用户显式取消勾选 reasoning 后小幅修改 ID 再改回，defaults 会重新强制勾选。

**修复建议**：改为在 ID 输入 blur/提交时才应用精确默认值；或记录每个字段的自动填充来源 key，当当前 ID 不再精确命中该 key 时清除对应自动填充值，仅保留用户手改内容。

**验证结论**：机制链全部核实。(1) 逐键触发：CustomProviderModelCard.tsx:329 的 TextField onChange 最终来自 Kobalte TextFieldRoot（@kobalte/core dist/chunk/MKJEDDFV.jsx:135-146），onInput 每次按键即回调 onChange，无去抖/无 blur 门控；CustomProviderDialog.tsx:1081 onChangeId={(v) => fill(i(), v)}。(2) 精确命中即应用：fill()（CustomProviderDialog.tsx:526-535）调用 defaultsForModel（CustomProviderDefaults.ts:285-292）按 defaultKeys 精确键匹配（含小写/bare/fallback），命中则 apply() 并 setSuggestion(undefined)。(3) 只补不收：apply()（475-502 行）的 flag/field 仅在字段为空时写入，无命中失效回收逻辑；catalog 中确实存在前缀恰为完整 ID 的模型（openai 的 gpt-5 与 gpt-5-mini；测试数据 tests/unit/custom-provider-defaults.test.ts:30 的 glm-5.2），逐字输入途经前缀时错误的成本/limit/variants 被填入，且最终 ID 即使也精确命中，field 因字段已非空不会用正确值覆盖，问题比描述更广。(4) reasoning 强制勾选：apply 第 481-482 行在 defaults.reasoning 为 true 或存在 variants 时把用户取消的勾选重新置为 true。反证不成立：choose() 的 replaceModelDefaults 全量覆盖仅在候选建议出现时可用，精确命中路径直接清空 suggestion；单测只覆盖纯函数，无测试将此行为锁定为预期。severity medium 恰当：静默保存错误模型的价格/limit 影响成本估算与上下文管理且不易察觉。


### F05【中等/缺陷】热更新绕过 disabled_providers / enabled_providers，复活已禁用 Provider

- **域**：hot-reload
- **位置**：`packages/opencode/src/kilocode/provider/config-refresh.ts:171`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：refresh() 增量判定追加启停名单检查：以新配置构建 disabled_providers/enabled_providers 集合（diff() 已保证两份配置除 provider 段外完全一致，读新配置即可），changed id 命中不允许名单时判为非增量返回 false 走全量重建，语义与 provider.ts 的 isProviderAllowed 一致。新增集成测试「编辑已禁用的自定义 Provider 不会复活它」与「编辑不在 enabled_providers 名单中的自定义 Provider 不会激活它」，并做了红-绿验证（临时回退判定后两测试确实失败）。

**修改文件**：`packages/opencode/src/kilocode/provider/config-refresh.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/provider-config-refresh.test.ts → 17 pass 0 fail

**问题描述**：refresh() 的增量判定只检查 !catalog[id] 和 providers[id].source === "config"，build() 也不检查启停名单。若某自定义 Provider 已列入 disabled_providers（或不在 enabled_providers 中）——此时它不在运行时 providers 里，恰好满足增量条件——用户再编辑该 Provider 的 models 配置时，diff() 只看到 provider 段变化仍走增量路径，第 214 行会把 build() 结果直接写入 state.providers，被禁用的 Provider 及其模型立即出现在 list()/getModel() 中；重启后又消失，行为不一致。provider-config-refresh.test.ts 只覆盖了"修改 disabled_providers 列表本身触发全量重建"，未覆盖"编辑已禁用 Provider"这一场景。

**修复建议**：在 refresh() 中对 changed id 追加启停判定：命中 disabled_providers/enabled_providers 的 id 直接判为非增量（返回 false 走全量重建），或在安装阶段跳过被禁用的 id 并同样 bump version。补充对应测试。

**验证结论**：核实属实。config-refresh.ts 的 refresh() 增量判定（第 171-177 行）只检查 `!input.state.catalog[id]` 与 `!input.state.providers[id] || source === "config"`，build()（第 61-162 行）只处理模型级 blacklist/whitelist，全文无任何 disabled_providers/enabled_providers 检查。而全量构建路径在 provider.ts:1401-1408 定义 isProviderAllowed 并在 1642-1647 行删除被禁用 Provider。场景推演成立：自定义 Provider 列入 disabled_providers 后初始构建将其从 providers 删除（恰好满足 `!providers[id]`），且自定义 Provider 不在 models.dev catalog（`!catalog[id]` 成立）；此时编辑该 Provider 的 models，diff()（第 46-55 行）因 disabled_providers 未变而只返回 provider 段变化的 id，走增量路径，第 214 行 `input.state.providers[item.id] = item.provider` 将其写回运行时注册表。Provider.list()（provider.ts:1730-1732）直接返回 state.providers 无二次过滤，HTTP 层 handlers/provider.ts:58-64 也把 connected 未过滤地合并进响应，复活的 Provider 会直接暴露给 UI 与 getModel()。测试 provider-config-refresh.test.ts:325-345 仅覆盖"修改 disabled_providers 名单本身触发全量重建"，未覆盖"编辑已禁用 Provider"场景。重启后全量构建再次过滤，行为不一致属实。medium 级别恰当。


### F06【中等/回归】configUpdate 端点移除 disposeAll 后，MCP 等实例级服务不再感知全局配置变更

- **域**：upstream-touch
- **位置**：`packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts:95`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：configUpdate 端点恢复非 provider 配置变更的销毁语义：PATCH 前后各取一次 getGlobal()（同一加载管道保证形状可比），changed 时用 ConfigRefresh.diff() 判定——仅 provider 段变化走现有热更新路径（自定义 Provider 保存不重启的核心特性保留）；其他配置键（mcp/lsp/agent 等）变化时恢复上游 v7.4.16 的 bridge.run(disposeAllInstancesAndEmitGlobalDisposed({swallowErrors:true})) 调用形态，让 MCP 等实例级快照服务经实例重建感知新配置。测试更新说明：global-config-refresh.test.ts 原固化断言「indexing 段 PATCH 不销毁实例」与新语义冲突（indexing 属非 provider 键，现在应销毁），改写为「provider 段 PATCH 不销毁且新模型立即可见」，并按批次要求新增「mcp 段 PATCH 后实例被销毁（同步等待销毁完成才返回）」测试。

**修改文件**：`packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`、`packages/opencode/test/kilocode/global-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/global-config-refresh.test.ts → 5 pass / 0 fail；相邻回归 server/config-overlay、httpapi-global-sse、tui-config、httpapi-cors 等全部通过

**问题描述**：上游 v7.4.16 中 GlobalHttpApi.configUpdate 在 changed 时会 disposeAllInstancesAndEmitGlobalDisposed，实例重建保证所有在构建期快照配置的服务（MCP 客户端、LSP 等）拿到新配置。现在只依赖 Config.updateGlobal 内部的缓存失效 + ConfigUpdated 事件：Config/Provider（current() 按配置引用同步）和 Agent（KiloAgent.cacheKey 版本检查）有热重建路径，但 mcp/index.ts 的 InstanceState 在构建时读取 cfg.mcp 且没有任何版本检查或事件订阅，服务端也无 ConfigUpdated 监听方去失效它。通过 SDK global.config.update 修改 mcp、lsp 等配置的调用方（provider-actions.ts 也走这个端点，TUI/脚本亦可调用）会发现改动不生效，直到实例被其他路径销毁。扩展设置页大部分走 config-console overlayUpdate（仍保留 dispose），因此扩展主路径侥幸未受影响，但公共端点语义已变。

**修复建议**：为 configUpdate 保留可选的 dispose 语义（如按 patch 内容判断是否仅涉及 provider 字段，非 provider 字段变更仍走 disposeAll），或为 MCP 等服务补充与 Agent.cacheKey 同类的配置版本检查。

**验证结论**：核实属实。global.ts:93-98 现在仅调用 config.updateGlobal 并直接返回，上游 v7.4.16 在 result.changed 时会执行 disposeAllInstancesAndEmitGlobalDisposed（已用 git show 确认）。updateGlobal（config.ts:1049-1117）changed 时只做 reset()（失效 Config 自身缓存）+ 发 ConfigUpdated 事件，不销毁实例。热重建路径核实：Provider 有 current() 的配置引用比对（provider.ts:1713），Agent 有 cacheKey 版本检查（agent.ts:518,531），但 mcp/index.ts:480-484 的 InstanceState 在构建时快照 cfg.mcp，唯一失效途径是 instance-state.ts:38 的 registerDisposer（实例 dispose 时触发），全代码库无服务端 ConfigUpdated 订阅方去失效它（grep 确认订阅方仅在 tui/plug 等客户端侧）。通过该端点修改 mcp 配置后新 server 不会连接、删除的 server 客户端仍保留。扩展主路径确实走 config-console.ts:85（保留 disposeAllInstancesAndEmitGlobalDisposed），侥幸未受影响的说法准确。medium 恰当。


### F07【中等/回归】dispose 超时分支放弃 uninterruptible，超时后实例部分销毁且不发出 global.disposed 事件

- **域**：upstream-touch
- **位置**：`packages/opencode/src/server/global-lifecycle.ts:31`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：global-lifecycle.ts 超时分支拆为「可中断的 disposeAll + 不可中断的 emitGlobalDisposed」：外层 Effect.uninterruptibleMask，restore 只恢复 disposeAll 的可中断性使 timeoutOrElse 能中断它（超时记录明确 warn：instances may be partially disposed），事件发送保持在不可中断区域，销毁超时后 global.disposed 事件也必然发出（扩展端 KiloProvider 依赖该事件触发刷新）。非超时分支保持上游整体 uninterruptible 语义不变。新增 test/kilocode/global-lifecycle.test.ts 三条测试：正常完成发事件、disposeAll 永久挂起（Effect.never）超时中断后事件仍发出、无超时分支完整销毁并发事件。

**修改文件**：`packages/opencode/src/server/global-lifecycle.ts`、`packages/opencode/test/kilocode/global-lifecycle.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/global-lifecycle.test.ts → 3 pass / 0 fail

**问题描述**：上游 disposeAllInstancesAndEmitGlobalDisposed 整体包在 Effect.uninterruptible 中，保证销毁流程完整且必然 emit global.disposed。新增 timeout 分支（global.ts dispose 端点传 5 秒）使用 timeoutOrElse，超时会直接中断 store.disposeAll()：实例可能只销毁了一半（LSP、watcher 等资源残留），且中断发生在 emitGlobalDisposed 之前，事件永远不会发出。扩展端 KiloProvider.ts:4320 依赖 global.disposed 触发 reloadAfterAuthChange，超时路径下该刷新不会发生，而 HTTP 端点仍返回 true，调用方无从得知销毁未完成。

**修复建议**：超时分支至少将 work 拆为"可中断的 disposeAll + 不可中断的 emitGlobalDisposed"，即便销毁超时也保证事件发出；并考虑在超时返回值/日志中向调用方暴露未完成状态。

**验证结论**：核实属实。global-lifecycle.ts:22-37：work = disposeAll + emitGlobalDisposed 的组合，timeout 分支（29-36 行）用 Effect.timeoutOrElse 包裹整个 work 且未加 uninterruptible，超时会中断 disposeAll（实例可能部分销毁）且 emitGlobalDisposed（27 行，位于 disposeAll 之后）不会执行；orElse 只记一条 warn 日志。非超时分支（38 行）仍保留 Effect.uninterruptible，可见作者知道该流程本应不可中断。global.ts:101-104 的 dispose 端点传 timeout: "5 seconds" 且无论是否超时都返回 true，调用方无从得知销毁未完成。上游 v7.4.16 的 dispose 端点调用无 options 的版本（整体 uninterruptible 且必然 emit）。扩展端确实依赖 global.disposed 事件做后续刷新（KiloProvider.ts 中订阅），超时路径下事件丢失的影响链成立。审核员的修复建议（可中断 disposeAll + 不可中断 emit）与代码结构吻合。medium 恰当。


### F08【中等/缺陷】fetch 的 stale 判断把失败留下的空对象当作可用缓存，失败后前台请求永远拿空列表

- **域**：upstream-touch
- **位置**：`packages/opencode/src/provider/model-cache.ts:326`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：fetch 的 stale 快速路径改为 previous 非空对象（Object.keys(previous).length > 0）才生效：一次失败或空结果 commit 的空对象 {} 过期后不再被当作可用缓存返回，而是与上游语义一致走同步 evaluate 重新拉取，消除「网络恢复后前台仍拿空列表、只能等后台刷新恢复」的窗口。新增测试「空缓存过期后前台请求同步重取而不是返回空列表」（测试 helper layer 增加 empty 参数模拟第 N 次返回空模型列表）。

**修改文件**：`packages/opencode/src/provider/model-cache.ts`、`packages/opencode/test/kilocode/model-cache-effect.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/model-cache-effect.test.ts → 16 pass / 0 fail；model-cache-org、kilo-models-401-fallback 回归通过

**问题描述**：commit 在 result.error 时也会无条件把 entry.view.models 覆盖为 {}（空对象）并刷新 timestamp。fetch 中 previous = active.get(id)?.view.models，空对象 {} 为 truthy：一旦某 provider 发生过一次失败（或返回过空结果），TTL 过期后 if (previous) 恒为真，前台请求直接返回 {} 并只发起后台刷新；上游此时会同步重取并把真实结果或错误返回给调用方。表现为网络已恢复的情况下，前台仍拿到空模型列表，必须等后台刷新完成并通过 recovered 通知才能恢复，一次瞬时故障的可见影响被拉长。

**修复建议**：stale 快速路径改为 Object.keys(previous).length > 0 才生效，空结果/失败结果过期后仍走同步 evaluate 路径。

**验证结论**：核心逻辑核实属实。fetchKiloModels 失败时返回 { models: {}, error }（kilo-gateway/src/api/models.ts:94），evaluate 中这是成功 exit，commit（model-cache.ts:239-241）无条件写入 entry.view.models = {} 并刷新 timestamp。fetch（322-330 行）中 previous = active.get(id)?.view.models，空对象 {} 为 truthy，TTL 过期后 if (previous) 恒真，前台直接返回 {} 并只发起后台刷新。上游 v7.4.16 对比确认：其 get 在过期时清空 view.models（上游 278-279 行）且 fetch 无 stale 路径，过期后同步 evaluate 重取。差异真实存在。唯一不准确处是标题的「永远」：后台刷新成功后 commit 的 recovered 判定（229-232 行，failed 或 previous 为空对象时为真）会触发 ModelsRefresh.notify 使 Provider 状态失效，后续请求即恢复——描述正文对此已如实说明（「必须等后台刷新完成并通过 recovered 通知才能恢复」）。考虑到空模型列表窗口内 Provider state 会把空 models 的 provider 从注册表删除（provider.ts:1684-1687），影响用户可见，medium 恰当。


### F09【中等/质量】current() 用服务级单信号量串行化所有目录实例的全部 Provider 读取

- **域**：upstream-touch
- **位置**：`packages/opencode/src/provider/provider.ts:1706`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：Provider.current() 增加无锁快速路径：先 config.get()（其内部 stamp 检查即外部修改检测，无法省略否则破坏热更新核心特性）再读 InstanceState 缓存，cached.config === cfg 时直接返回不进入服务级信号量；检测到变化才进锁，锁内重读最新配置与缓存做二次检查防止对同一快照重复刷新。InstanceState 基于 ScopedCache（同 key 并发构建自带去重），快速路径触发的首次构建不会重复执行且不再阻塞其他工作区目录。新增行为测试「配置未变化时重复读取复用缓存状态（同一引用）且热更新仍生效」；「不进锁」本身无法从外部直接断言，行为等价性由 provider 全测试套（provider.test.ts 89 条 + provider-config-refresh 19 条 + custom-provider-delete 等）逐一回归锁定。

**修改文件**：`packages/opencode/src/provider/provider.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/provider/provider.test.ts → 89 pass；test/provider/ 全目录 428 pass；provider-config-refresh + custom-provider-delete 27 pass；全部 0 fail

**问题描述**：Provider layer 每进程只构建一次，lock = Semaphore.makeUnsafe(1) 因而是跨所有工作区目录共享的。list/getProvider/getModel/getLanguage/closest/defaultModel 每次调用都要先获取该信号量，临界区内执行 config.get()（内部 reload() 会全文读取最多 6 个全局配置文件做 stamp 比对），并可能触发 InstanceState 全量重建（含 ModelCache 网络请求）。后果：A 工作区的一次全量重建会阻塞 B 工作区的所有模型解析；getLanguage 位于每次 LLM 请求的热路径，串行 + 每次 stamp 文件 I/O 在 Remote-SSH 慢盘场景会放大延迟。上游 list 只是 InstanceState.use 的一次缓存读取。

**修复建议**：增加无锁快速路径：先读 InstanceState 缓存并比较 cached.config 与 config 引用，只有检测到变化时才进入信号量执行刷新；或将锁粒度改为 per-directory。

**验证结论**：核实属实。provider.ts:1706 的 lock = Semaphore.makeUnsafe(1) 在 Layer.effect 构建体内创建（1336 行），layer 进程内只构建一次，InstanceState 按 directory 分键即证明服务跨工作区共享，故信号量为全局单例。current()（1708-1728 行）的全部调用点核实：list(1731)、getProvider(1883) 及 1888/1914/1946/1967/2041 共 7 处，覆盖 getModel/getLanguage/closest/defaultModel。临界区内 config.get()（config.ts:991-994）每次 reload → refreshGlobal → KilocodeGlobalConfigStamp.read 全文读取恰好 6 个全局配置文件（global-stamp.ts:6）；InstanceState.get miss 时全量重建经 modelsDevSvc.get()（provider.ts:1351）→ cache.fetch("kilo"/"apertis")（models.ts:58,84）确含网络请求（10 秒超时），期间阻塞所有其他目录的模型解析。上游 v7.4.16 的 list 确为纯缓存读取（其 1689 行 InstanceState.use），且上游 Provider 读取不经过 config.get 的 stamp I/O。需补充的公平性说明：stamp I/O 本身上游 Config.get 已有，本次新增的是把它引入 Provider 热路径并叠加全局串行化。medium 恰当。


### F10【中等/架构】build() 与 provider.ts create() 的自定义 Provider 编译逻辑大段重复，升级易漂移

- **域**：upstream-touch
- **位置**：`packages/opencode/src/kilocode/provider/config-refresh.ts:63`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：新建 packages/opencode/src/kilocode/provider/compile.ts，把自定义 Provider 编译收敛为单一共享纯函数：compileProviderInfo（顶层 name/env/options/source）、compileConfigModels（capabilities/cost/limit/headers/modalities/interleaved deepseek 特判/patchConfigModel/orderedVariants 全 fallback 链，含可选 modelsDev npm/api 兜底参数）、finalizeProviderModels（api.id 兜底、gpt-5-chat 别名剔除、alpha/deprecated 过滤、black/whitelist、空 variants 兜底、configVariants 重排）。config-refresh.build() 与 provider.ts 全量构建路径均改为调用共享实现，provider.ts 三处调用点均加 kilocode_change 标记。语义以全量构建为准：build 侧因统一新获得的 gpt-5-chat 特判与 modelsDev 兜底在增量守卫（!catalog[id]）下不可达，configVariants 二次重排经分析为幂等，两侧现有行为均未改变。新增「增量刷新产物与重启后全量重建产物逐字段一致」对拍测试：patch 后取增量产物快照，disposeAllInstances 模拟重启后取全量产物，structuredClone + toEqual 深比较，覆盖 id 映射、modalities、cost cache、headers、variants 顺序、删除哨兵、黑名单、deepseek interleaved 等分支，并抽查关键字段防止空对空比较。

**修改文件**：`packages/opencode/src/kilocode/provider/compile.ts`、`packages/opencode/src/kilocode/provider/config-refresh.ts`、`packages/opencode/src/provider/provider.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/provider-config-refresh.test.ts → 17 pass；bun test test/provider/provider.test.ts → 89 pass；bun test test/kilocode/custom-provider-delete.test.ts test/kilocode/provider-transform.test.ts test/kilocode/provider-variant-order.test.ts → 14 pass；改动文件 tsc --noEmit 无错误（仅剩 test/kilocode/cli-shutdown.test.ts 一处与本批次无关的预存类型错误）

**问题描述**：config-refresh.ts 的 build() 用约 150 行复刻了 provider.ts 全量构建路径中自定义 Provider 的模型编译逻辑（capabilities/cost/limit/headers 的 fallback 链、patchConfigModel、orderedVariants、status 过滤、black/whitelist、空 variants 兜底）。增量刷新产物必须与重启后全量重建产物逐字段一致，否则会出现"热更新后行为 A、重启后行为 B"的隐性不一致；上游每次修改 provider.ts 编译逻辑都需要人工同步这份拷贝，而两处之间没有共享实现或一致性测试保障（现有测试只覆盖 variant 顺序等局部）。

**修复建议**：把自定义 Provider 的模型编译抽为单一共享函数（放在 kilocode 边界内），provider.ts create() 与 config-refresh.build() 都调用它；至少补一个"增量刷新产物 === 全量重建产物"的对拍测试。

**验证结论**：核实属实。config-refresh.ts:61-162 的 build()（约 100 行，非 150 行，轻微夸大但不影响结论）与 provider.ts:1441-1531 的全量构建路径逐字段重复：capabilities（temperature/reasoning/attachment/toolcall/modalities/interleaved 含 deepseek 特判）、cost（cache_read/cache_write fallback 链）、limit、headers、name 推导 iife、patchConfigModel、orderedVariants 全部复刻；status 过滤与 black/whitelist、空 variants 兜底（config-refresh.ts:146-158）对应 provider.ts:1642-1688 的后处理循环。两处无共享实现（config-refresh.ts 仅从 kilocode/provider/provider 导入 orderedVariants 与 patchConfigModel 两个工具函数，主体 fallback 链各自独立维护）。测试核实：provider-config-refresh.test.ts 有 12 个行为级测试（增删改模型、多实例刷新、并发保存等），覆盖比审核员所述「只覆盖 variant 顺序等局部」更广，但确无「增量刷新产物 === 全量重建产物」的逐字段对拍测试，热更新与重启产物漂移无测试保障。对需定期合并上游的 fork（provider.ts:1454-1459 已有 modelsDev fallback 等两处差异苗头）维护风险真实，medium 可接受。


### F11【中等/回归】buildTriggerLabel 在 providers 加载后不再显示未解析 raw 选择，设置页显示 Not set 掩盖真实配置值

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts:101`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：给 buildTriggerLabel 追加第 9 个可选语义参数 semantics: TriggerLabelSemantics（"resolved" | "configured"，默认 "resolved" 保持向后兼容）：configured 语义下 raw 兜底分支不再受 !hasProviders 限制，恢复上游『providerID / modelID』原样显示；resolved 语义保持现有新逻辑。ModelSelectorBase 新增 labelSemantics prop 透传该参数；设置页 7 处调用方（ModelsTab 的默认模型/small model/subagent 模型/autocomplete 模型/per-mode 模型共 5 处、ModeEditView 模型覆盖 1 处、ExperimentalTab swe_pruner_model 1 处）显式传 "configured"；聊天选择器（ModelSelector 主路径）与 NewWorktreeDialog 保持默认 resolved。测试说明：原锁定测试 'ignores unresolved raw selection after providers are available' 的断言完整保留（默认语义行为不变），仅改名标注 resolved 语义并补充显式传参断言；新增 4 个 configured 语义测试（非 kilo raw 兜底、kilo raw 只显示 modelID、无配置时仍显示 clearLabel、resolvedName 优先于 raw）。审核建议中『可附加不可用标注』未实现——那需要新增 i18n key 和 UI 元素，会扩大入侵面，本轮按最小方案只恢复 raw 显示。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts`、`packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx`、`packages/kilo-vscode/webview-ui/src/components/settings/ModelsTab.tsx`、`packages/kilo-vscode/webview-ui/src/components/settings/ModeEditView.tsx`、`packages/kilo-vscode/webview-ui/src/components/settings/ExperimentalTab.tsx`、`packages/kilo-vscode/tests/unit/model-selector-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/model-selector-utils.test.ts tests/unit/provider-utils.test.ts tests/unit/model-selection.test.ts tests/unit/provider-context.test.ts tests/unit/server-context-source.test.ts → 82 pass / 0 fail；外围回归 bun test tests/unit/session-model-store.test.ts tests/unit/autocomplete-model-selector.test.ts 等 6 文件 → 153 pass / 0 fail

**问题描述**：上游在 raw.providerID/modelID 存在时始终显示 "providerID / modelID" 兜底标签；改动后加了 !hasProviders 条件，providers 加载完成但选择不可见（provider 未连接、kilo 付费模型、模型被删）时落入 allowClear 分支显示 clearLabel。聊天选择器场景配合模型回退是合理的，但 ModelsTab（默认模型、per-mode 模型）和 ModeEditView 直接展示 config.model / config.agent.*.model 配置值，用户在配置文件中写了未连接 provider 的模型时设置页显示 "Not set"，而配置值实际存在且生效逻辑仍会读取它，造成配置状态误导。

**修复建议**：区分场景：设置页（展示配置值语义）保留上游 raw 兜底显示，可附加"不可用"标记；仅在聊天选择器（展示将实际使用的模型）应用新逻辑。可通过给 buildTriggerLabel 增加语义参数或由调用方决定是否传 raw。

**验证结论**：核实属实。git diff v7.4.16..HEAD 显示该文件唯一改动即 model-selector-utils.ts:101 在 raw 兜底分支追加 && !hasProviders（提交 dcbffd614f，附带测试『ignores unresolved raw selection after providers are available』，说明是有意为之）。调用链核实：buildTriggerLabel 仅在 ModelSelector.tsx:739 被调用，activeModel 经 visibleModels 解析（ModelSelector.tsx:163 findModel 用 visibleModels），hasProviders = visibleModels().length > 0（第 250 行）；ModelsTab.tsx:111-118 默认模型选择器 value=parseModelString(config().model) 且 allowClear + clearLabel=Not set，ModeEditView.tsx:181/198 同理。因此当 config.model 指向未连接 provider 时：上游显示 "providerID / modelID" 兜底，现落入 allowClear 分支显示 "Not set"，但配置文件中该值仍然存在（重连 provider 后立即恢复生效），设置页确实掩盖了真实配置状态，用户可能误以为未配置并重新设置覆盖原值。需修正审核员一处细节：在本 fork 中 webview 的 resolveModelSelection（model-selection.ts:36-38）对 mode/global 也做 validate，不可见时会跳过回退，故『生效逻辑仍会读取它』仅在 provider 重连后或非 webview 路径成立，但这不改变『配置值存在却显示 Not set』的误导本质。聊天选择器（PromptInput 传 resolve 后的 selected() 值）确实是新逻辑的合理场景，区分场景的建议成立。medium 恰当。


### F12【中等/入侵性】为一行行为变化对上游 server.tsx 消息处理 switch 做整体函数化重构

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/src/context/server.tsx:77`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：已将 server.tsx 整体回退为上游 v7.4.16 的原始 switch 结构（以 git show v7.4.16 版本为基础重写），仅保留唯一行为补丁：connectionState case 内插入 if (message.state !== "connected") setServerInfo(undefined)，附 kilocode_change 中文注释说明用途（断连/重连窗口内避免使用失效的服务器地址与凭据，源自 remote ssh Provider 同步修复 7fbcfa4dd4）。回退前自行逐语句复核了六个 handler 与上游 switch 的等价性：ready case 各语句与顺序一致；connectionState 的 if+return 与上游 if/else-if 控制流等价；error/profileData/四个 deviceAuth case 语句一致（并恢复了重构时丢失的上游注释 'Reset to idle after a short delay'）；workspaceDirectoryChanged/languageChanged 内联一致——未丢任何行为。回退后 git diff v7.4.16 该文件仅剩 3 行插入（1 行行为补丁 + 2 行注释），diff 面从 187 行降到 3 行。测试覆盖：新增 server-context-source.test.ts 补丁存在性守卫（锁定补丁行位于 connectionState case 内、带 kilocode_change 标记、且在 error 分支之前），防止后续三方合并上游 tag 时误丢该行；handler 位于组件内部不导出且仓库无 Solid 组件渲染测试设施，故采用与仓库既有 *-source.test.ts 一致的轻量守卫方式而非行为测试。另说明：kilocode_change 标记按 README 严格来说仅对共享 opencode 文件强制，此处按审核建议附加，无副作用。

**修改文件**：`packages/kilo-vscode/webview-ui/src/context/server.tsx`、`packages/kilo-vscode/tests/unit/server-context-source.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/server-context-source.test.ts（含于 5 文件批跑）→ 82 pass / 0 fail

**问题描述**：本文件相对上游的唯一实质行为变化是 connectionState 非 connected 时 setServerInfo(undefined)（第 77 行），但改动把上游单个 switch 整体拆分为 handleReadyMessage/handleConnectionStateMessage/handleErrorMessage/handleProfileDataMessage/handleDeviceAuthMessage/handleServerMessage 六个函数（约 187 行 diff）。该文件与本域功能无直接关系，纯结构重组违反 README 维护原则中"保持 ZLF 补丁最小化"的要求，显著扩大后续上游合并该文件时的冲突面。

**修复建议**：回退为上游原 switch 结构，仅插入单行 setServerInfo(undefined) 补丁并加 kilocode_change 注释；如认为重构有价值，应推给上游而非在下游维护。

**验证结论**：核实属实。git diff v7.4.16..HEAD --numstat 显示 server.tsx 为 108 插入/79 删除（共 187 行 diff），与审核员所述一致。逐行比对 diff：唯一实质行为变化是 handleConnectionStateMessage 中新增 `if (message.state !== "connected") setServerInfo(undefined)`（HEAD server.tsx:77，由提交 7fbcfa4dd4 单行加入）；error 分支从上游 if/else-if 改为 if+return 逻辑等价。其余全部为纯结构重组（提交 51fa5f9329，107+/79-）：上游单个 switch 拆为 handleReadyMessage/handleConnectionStateMessage/handleErrorMessage/handleProfileDataMessage/handleDeviceAuthMessage/handleServerMessage 恰好六个函数，各 case 内语句逐一对应、无行为差异。反证检查未发现重构的技术必要性：六个 handler 均为组件内部函数、未导出、无任何测试引用（grep 测试目录零命中），无可测试性收益；文件内亦无 kilocode_change 标记。README.md:25 明确『继续保持 ZLF 补丁最小化』、README.md:29『需要改变行为时，保留兼容壳并把新逻辑放到清晰边界内』，server.tsx 是上游 v7.4.16 已有的活跃文件，187 行结构 diff 会实际扩大后续官方 tag 三方合并的冲突面。需修正一处表述：README.md:26 第 1 条将 packages/kilo-vscode 列为 ZLF 改动优先区域，kilocode_change 标记严格说仅对共享 packages/opencode 文件强制（README.md:27 第 2 条），且『该文件与本域无直接关系』不完全准确（setServerInfo(undefined) 属 remote ssh provider 同步修复的一部分）——但这只弱化措辞，不动摇『一行行为变化不需要 187 行重构』的核心结论。作为侵入性/维护成本类发现，medium 在该仓库明确的最小补丁维护原则下可以维持。


### F13【中等/缺陷】handleServerExit 自动 recover 无退避与重试上限，后端反复崩溃时形成无节流重启循环

- **域**：misc-infra
- **位置**：`packages/kilo-vscode/src/services/cli-backend/connection-service.ts:928`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：为 connection-service.ts 的 recover 增加连续失败计数与 1s/5s/30s 指数退避（新增导出纯函数 resolveRecoveryDelayMs，退避序列/稳定窗口做成实例字段便于测试注入）；连续 5 次自动恢复失败后清理残余连接并停在 error 状态，错误信息提示手动重试（手动重试走 connect()，不受上限约束）；doConnect 确认连接成功后调度 60 秒稳定计时，稳定保持后清零计数，稳定窗口内连接再次被重置（resetConnection）则取消计时防止绕过上限；dispose 同步清理计时器。新增 7 个测试覆盖退避序列、上限停止、退避期间单飞复用、稳定重置与重置取消。

**修改文件**：`packages/kilo-vscode/src/services/cli-backend/connection-service.ts`、`packages/kilo-vscode/src/services/cli-backend/connection-service.test.ts`

**测试**：cd packages/kilo-vscode && bun test src/services/cli-backend/connection-service.test.ts —— 通过（含既有用例）

**问题描述**：上游行为是进程退出后 setState(error) 等用户手动重试；现在 handleServerExit 无条件调用 recover 自动重建 Server+SDK+SSE。若 CLI 后端能成功输出端口（启动成功）但随后持续崩溃（如某扩展/配置导致运行期 panic），每次 exit 事件都会立即触发新一轮 spawn，没有指数退避、没有连续失败计数上限，会无限循环拉起进程，耗费资源且用户只看到状态反复闪烁。只有启动阶段直接失败（未输出端口）时循环才会终止。

**修复建议**：为 recover 增加连续失败计数与指数退避（如 1s/5s/30s），超过阈值后停在 error 状态提示用户手动重试；成功保持连接一段时间后再重置计数。

**验证结论**：对照上游 v7.4.16：其 handleServerExit 仅 setState("error", new Error("...Retry to reconnect."))，等待用户手动重试；当前版本 connection-service.ts 行 928-933 无条件 void this.recover(...)。核实 recover（行 884-910）全程无延迟、无失败计数：recoveryPromise 单飞仅覆盖恢复进行期间，finally 中置 null（行 904-906）；resetConnection（行 912-926）还把 healthFailures 清零。恢复路径 forgetServer → startConnection → doConnect → serverManager.getServer() 直接 spawn 新进程（server-manager.ts 行 137）。运行期崩溃时 exit 处理器（server-manager.ts 行 211-217）满足 this.instance?.process === serverProcess，触发 onExit → handleServerExit → recover，形成无限循环；每轮周期仅受 CLI 启动耗时约束（秒级），无任何退避。审核员对终止条件的判断也正确：启动阶段未输出端口即退出时 instance 尚未赋值，onExit 不触发，仅 reject 使 recover 以 error 收尾。反证检查：cli-backend/retry.ts 未被 connection-service.ts 或 server-manager.ts 引用（grep 无结果）；sdk-sse-adapter.ts 的指数退避（行 63-64）仅作用于 SSE 流重连，不节流进程重启；connection-service.test.ts 无 recover/handleServerExit/pollHealth 相关测试。无缓解机制，medium 级别恰当（循环为秒级而非毫秒级疯转，且仅在“启动成功后持续崩溃”场景触发）。


### F14【中等/缺陷】健康检查假阳性触发 dropInstance 会删除共享状态文件或杀掉共享进程组，导致双后端分裂

- **域**：misc-infra
- **位置**：`packages/kilo-vscode/src/services/cli-backend/server-manager.ts:392`
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：server-manager.ts dropInstance 破坏性收敛：shared 实例（无 process）健康检查失败时只放弃本窗口连接，仅在 isProcessAlive=false 确认进程已死后才删除 server-start.json，进程存活时保留文件供下一轮 getServer 重读共享状态；owned 实例进程已死时只做兜底清理（clearSharedState 有 pid 匹配保护，幂等），进程存活（挂死）时发 SIGTERM+SIGKILL 兜底但不直接删状态文件——由进程 exit 事件处理器在确认退出后清理，保证「删除状态文件」始终发生在进程确认死亡之后。同时修复 getSharedServer 复用路径的同类问题：健康检查失败但进程仍存活时不再删除状态文件（后续 writeSharedState 原子覆盖，不留无人管理空窗）。保留「确认已死后清理陈旧状态」的既有正确场景并有测试锁定。新增 6 个测试覆盖四种 dropInstance 组合与两种 getSharedServer 场景。

**修改文件**：`packages/kilo-vscode/src/services/cli-backend/server-manager.ts`、`packages/kilo-vscode/tests/unit/server-manager-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/server-manager-utils.test.ts —— 通过（含既有用例）

**问题描述**：connection-service.ts pollHealth（行 852）连续 3 次 HTTP 健康检查失败即调用 recover → forgetServer → dropInstance。若失败是假阳性（后端高负载下 /global/health 3 秒超时约 30 秒，进程实际存活且其他窗口正常使用）：对 shared 实例（无 process）会 clearSharedState 删除 server-start.json，随后本窗口 startServer 拉起第二个后端并写入新状态，旧后端进程无人管理继续运行——形成两个后端、各窗口状态分裂，这正是 dispose() 注释（行 481-483）明确要避免的场景；对 owned 实例则直接 SIGTERM 整个进程组，把其他窗口正在共享使用的后端一并杀掉。上游原行为仅 sse.reconnect()，无破坏性。

**修复建议**：非 owner（shared）实例健康检查失败时只放弃本窗口连接并重读共享状态，不删除全局状态文件；owned 实例考虑在 kill 前用 isProcessAlive + 二次健康确认降低误杀，或将删除状态文件的权力仅保留给确认进程已死（isProcessAlive=false）的路径。

**验证结论**：代码路径完全核实：connection-service.ts 行 852-855 连续 3 次健康检查失败（每次 3 秒超时、10 秒间隔，约 30 秒窗口）即 recover；recover 行 892 调用 serverManager.forgetServer()；server-manager.ts forgetServer（行 498-502）→ dropInstance（行 392-400）。dropInstance 对 shared 实例（无 process 字段，见 getSharedServer 行 303 返回值）先 clearSharedState(pid) 删除 server-start.json（pid 匹配保护行 336-340 对 shared 实例必然通过）再 return；随后本窗口 startConnection → getServer → getSharedServer 因 readSharedState 返回 null（文件已删）而 fallback 到 startServer（行 81-83）拉起第二个后端并 writeSharedState 覆盖——旧后端仍存活且被 owner 窗口使用，正是 dispose 注释（行 481-483）明确要避免的 provider/chat 状态分裂场景。对 owned 实例则行 398 SIGTERM 整个进程组，共享该后端的其他窗口一并断连。dropInstance 全路径无 isProcessAlive 或二次健康确认。上游 v7.4.16 对照：pollHealth 失败仅 sse.reconnect()（上游行 748-749），无 HEALTH_FAILURE_LIMIT、无 recover，确无破坏性。假阳性前提（本地回环 /global/health 因事件循环阻塞连续超时）概率不高但真实存在，medium 恰当。


### F15【中等/架构】owner 窗口 dispose 直接 SIGTERM 共享后端，无引用计数或所有权移交，其他窗口生成中断

- **域**：misc-infra
- **位置**：`packages/kilo-vscode/src/services/cli-backend/server-manager.ts:471`
- **验证**：CONFIRMED
- **处理状态**：**保守处理**

**处理记录**：所有权移交/引用计数属大型重构，本轮不实施。已做两件事：(1) 在 server-manager.ts dispose() 补充详细中文注释，说明当前限制（后端生命周期绑定 owner 窗口、KILO_PARENT_PID watchdog、owner 关窗中断其他窗口）与彻底解决方向；(2) 实施低风险缓解——新增 ServerManager.isBackendProcessDead()（信号 0 探测，仅「确认已死」才返回 true，无假阳性）与 connection-service 的 probeBackendAfterDisconnect()：已建立的连接离开 connected 状态时（SSE 流断开进入重连循环发出的 connecting、以及 disconnected）立即探测后端进程，确认已死则立即 recover，把其他窗口的检测窗口从约 30 秒缩短到秒级；进程仍存活的短暂 SSE 中断仍交给 SSE 重连循环与常规健康轮询，不会提前触发破坏性重建。注意实现中修正了审核建议的一个细节：sdk-sse-adapter 重连循环期间发出的是 connecting 而非 disconnected，探测挂载点覆盖了两种状态。新增 5 个测试（probe 三场景 + isBackendProcessDead 两场景）。

**修改文件**：`packages/kilo-vscode/src/services/cli-backend/server-manager.ts`、`packages/kilo-vscode/src/services/cli-backend/connection-service.ts`、`packages/kilo-vscode/src/services/cli-backend/connection-service.test.ts`、`packages/kilo-vscode/tests/unit/server-manager-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test src/services/cli-backend/connection-service.test.ts tests/unit/server-manager-utils.test.ts —— 通过

**问题描述**：共享后端进程的生命周期完全绑定启动它的 owner 扩展宿主：dispose() 对 owned 进程发 SIGTERM+SIGKILL 兜底，且 KILO_PARENT_PID 指向 owner 宿主 pid（parent-watchdog 会在 owner 被硬杀时让 CLI 自杀）。因此 owner 窗口关闭时，所有复用该后端的其他窗口的连接必然中断，进行中的流式生成被杀，其他窗口最长需 ~30 秒（health-poll 3 次失败）才 recover 重建。dispose 中仅有 shared 实例不杀进程的单向保护，缺少反向保护。

**修复建议**：引入引用计数或所有权移交：owner 退出时若状态文件仍被其他窗口使用，由存活窗口接管（重新 spawn 并原子更新 server-start.json），或至少通过 providersChange/SSE 通道即时通知其他窗口立刻 recover，缩短中断窗口。

**验证结论**：行为链完全属实：server-manager.ts dispose（行 471-490）对 owned 进程 SIGTERM + scheduleKillFallback SIGKILL 兜底；spawn 时 KILO_PARENT_PID 设为 owner 扩展宿主 pid（行 160），packages/opencode/src/kilocode/parent-watchdog.ts（行 19-31）每秒探测该 pid，owner 宿主硬杀时 CLI 自杀——后端生命周期确实完全绑定 owner。反证检查其他窗口的检测通道：shared 实例（ServerInstance 无 process，行 303）没有 exit 监听（exit 处理器仅存在于 startServer 内的 owned 进程，行 211）；SSE 断开只走 sdk-sse-adapter 自身重连循环，sse.onStateChange 的 disconnected 分支（connection-service.ts 行 1006-1026）只 setState 不触发 recover；唯一升级路径是 pollHealth 累计 3 次失败（10 秒间隔），故其他窗口需约 20-30 秒才 recover，期间流式生成被杀，与描述一致。全仓库无引用计数、所有权移交或 owner 退出即时广播机制（dispose 中仅有 shared 不杀进程的单向保护，行 476-479）。作为 architecture 类发现属实且值得报告：上游每窗口独立后端不存在此耦合，共享后端是本仓库新增设计引入的缺口；系统 30 秒后可自愈且会话数据持久化在磁盘，故 medium 恰当，不宜升为 high。


### F16【低/缺陷】saveCustomProvider 在 auth.set/auth.remove 失败时不回滚已写入的 provider 配置

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/provider-actions.ts:828`
- **级别**：审读 medium → 验证修正为 **low**
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：saveCustomProvider 的 auth.set/auth.remove catch 分支新增配置回滚，使保存具备全有或全无语义：因 config.update 是深合并，回滚分两步——先写 provider:{[id]:null} 删除哨兵整体清除刚写入的条目并恢复 disabled_providers 原值，已有 provider 再写回保存前读取的 existing 完整配置（新建场景到第一步即完成）；回滚自身失败仅 console.warn，仍向用户上报原始 auth 错误。测试 mock 扩展 failAuthSet/failAuthRemove 注入项，新增 4 个用例覆盖新建回滚、已有恢复、auth.remove 失败、回滚自身失败仍报错。

**修改文件**：`packages/kilo-vscode/src/provider-actions.ts`、`packages/kilo-vscode/tests/unit/provider-actions-save.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/provider-actions-save.test.ts：39 pass 0 fail

**问题描述**：保存流程先执行 global.config.update 写入 provider 配置（含 reset 两阶段与失败回滚），随后才执行 auth.set/auth.remove。若 auth 阶段失败（网络闪断、后端瞬时不可用），catch 分支只做 notifyProvidersChanged + 后台刷新 + postError，已写入的 config patch 不回滚。结果是部分写入：模型/baseURL 变更已持久化，而 API key 仍是旧值或缺失。对新建 provider 场景，config 兜底合并（mergeConfiguredProviders）还会把这个无 key 的 provider 显示为 connected，用户若忽略错误提示，聊天请求会以缺失/旧 key 打到新 baseURL 上得到 401。失败回滚仅覆盖 reset→patch 之间的窗口，未覆盖 config→auth 之间的窗口，与'保存失败回滚'的完整性预期不符。测试也未覆盖该路径。

**修复建议**：auth 失败时用保存前读取的 existing 回滚 provider 配置（新建 provider 时写入 null 删除哨兵），或调整顺序为先 auth.set 后 config.update，使保存具备全有或全无语义；并为该路径补充单测。

**验证结论**：问题属实。provider-actions.ts 第 776-813 行先完成 global.config.update（含 reset 两阶段与 patch 失败回滚，第 798-811 行），第 815-822 行才执行 auth.set/auth.remove；auth 阶段的 catch（第 824-830 行）仅做 notifyProvidersChanged + refreshLater + refreshConfigLater + postError 后 return，未回滚已写入的 config，形成部分写入窗口。configuredCustomProviders（第 198-209 行）对 config 中的 custom provider 无条件 connected.add(id)（第 206 行），不校验 auth key，故新建 provider 在 auth.set 失败后确会显示为 connected。tests/unit/provider-actions-save.test.ts 的 mock 仅支持 failGlobalUpdateAt/failProvidersGet/failReady（第 30-35 行），既有回滚测试（第 478 行）只覆盖 reset→patch 窗口，auth 失败路径无测试。git 历史（086be8889e、7fbcfa4dd4）显示该 catch 自引入起即无回滚且无设计说明，而 reset→patch 回滚是专门实现的，说明这是完整性遗漏而非刻意取舍。但严重级别应降为 low：触发前提是 apiKeyChanged=true（resolveCustomProviderAuth，shared/custom-provider.ts 第 146-151 行）且对本地 CLI server 的 auth 调用恰好失败，概率低；失败时 postError 明确提示 'Failed to save custom provider'，并非静默；后台刷新会同步真实状态；用户重试保存即可幂等恢复。'401 打到新 baseURL' 还需用户无视错误提示继续使用，实际危害链路较长。


### F17【低/缺陷】self() 回退查找列表缺少当前扩展 ID itv3.zlfcode

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/extension-info.ts:6`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：extension-info.ts 提取 EXTENSION_ID 常量（itv3.zlfcode），self() 回退链首位加入 getExtension(EXTENSION_ID)，并以中文注释说明三级回退语义（当前身份→旧身份 itv3.kilo-code-plus→上游身份 kilocode.kilo-code）。新增测试断言 EXTENSION_ID 与 package.json 的 publisher.name 保持单一来源、回退链查询顺序、version() 不返回 unknown。

**修改文件**：`packages/kilo-vscode/src/extension-info.ts`、`packages/kilo-vscode/tests/unit/extension-info.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/extension-info.test.ts：7 pass 0 fail

**问题描述**：回退链为 ctx?.extension → itv3.kilo-code-plus（已弃用的旧身份）→ kilocode.kilo-code（上游身份），唯独没有当前实际发布的 itv3.zlfcode。目前所有 KiloProvider 构造点都传入了 extensionContext，ctx.extension 能兜住，但 KiloProvider 的 extensionContext 参数是可选的，一旦某个新调用点未传 ctx，version() 将返回 "unknown"，违反 README 验收表'关于页面版本信息不显示 unknown'的要求，且两个回退 ID 在本仓库身份下形同虚设。

**修复建议**：在回退链首位加入 vscode.extensions.getExtension("itv3.zlfcode")，或将扩展 ID 提取为常量与 package.json 保持单一来源。


### F18【低/缺陷】extensionKeybindings() 仍硬编码上游扩展 ID kilocode.kilo-code

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/agent-manager/vscode-host.ts:215`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：agent-manager/vscode-host.ts 的 extensionKeybindings() 改用 extension-info 的 self(this.context)（构造函数已持有 context，优先取 ctx.extension），消除最后一处硬编码上游扩展 ID kilocode.kilo-code。测试覆盖行为（ctx.extension 的 keybindings 被返回、不做 ID 查找）与源码断言（不再包含 getExtension("kilocode.kilo-code")）；agent-manager-arch.test.ts 架构测试通过（vscode-host 在 vscode 导入允许列表内，extension-info 位于 agent-manager 目录外不受约束）。

**修改文件**：`packages/kilo-vscode/src/agent-manager/vscode-host.ts`、`packages/kilo-vscode/tests/unit/extension-info.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/extension-info.test.ts tests/unit/agent-manager-arch.test.ts：均通过

**问题描述**：extension-info.ts 引入 self() 正是为了解决改名后 getExtension("kilocode.kilo-code") 返回 undefined 的问题（KiloProvider.ts 中两处已迁移），但 agent-manager/vscode-host.ts 的 extensionKeybindings() 漏改，在 itv3.zlfcode 身份下恒返回 []，Agent Manager 的快捷键提示功能失效。该文件不在本域文件列表内，但与 extension-info.ts 的改动目的直接相关。

**修复建议**：改用 extension-info.ts 的 self(ctx)（vscode-host 持有 context，可直接传入），消除最后一处硬编码上游 ID。


### F19【低/缺陷】handleProvidersChange 在拉取任务结束与 finally 清理之间的微任务窗口内排队的 fetch 无人消费

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/KiloProvider.ts:2284`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：fetchAndSendProviders 的 task.finally 清理后新增兜底：连接态下若 providersQueued 仍有排队项（即 task 返回与 finally 之间微任务窗口内被 handleProvidersChange 排队的请求）则补发一次 fetchAndSendProviders（其 while 循环经 advance 消费其余排队项），确保排队请求总有消费者；断连时跳过（重连后 refreshConnectionData 全量刷新）。新增测试通过 patch takeProviderFetch 在 advance 判空瞬间注入 handleProvidersChange 精确模拟该窗口，断言兜底补拉发生且 webview 收到第二份快照。

**修改文件**：`packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/tests/unit/kilo-provider-providers-refresh.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/kilo-provider-providers-refresh.test.ts：7 pass 0 fail

**问题描述**：providersRefresh 在 task.finally 中才被置 null，而 task 返回（队列已判空）到 finally 执行之间存在一个微任务窗口。若另一实例的保存/断开在该窗口内同步触发 notifyProvidersChanged，handleProvidersChange 会看到 providersRefresh 非空，于是只向 providersQueued 排队并 abort（此时已无在飞请求），且因 refreshing=true 不主动发起新 fetch。排队的 "connected" 项要等到下一次任意 fetchAndSendProviders 触发时才被 advance() 消费，该实例的 webview 在此期间保持过期 Provider 状态。实际影响被 SSE global.config.updated 兜底重拉大幅缓解，属于窄窗口竞态，但队列项被无限期搁置的可能性是真实存在的。

**修复建议**：在 handleProvidersChange 排队后检查 providersRefresh 对应任务是否已 settle（或在 task.finally 中发现 providersQueued 非空时补发一次 fetchAndSendProviders），确保排队请求总有消费者。


### F20【低/回归】connected 模式将 config 中的自定义 provider 无条件补入 connected，可能掩盖后端持久性加载失败

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/provider-actions.ts:198`
- **验证**：未单独验证（低级别）
- **处理状态**：**保守处理**

**处理记录**：评估结论：为 config 兜底注入的 provider 附加 filled 标记需要扩展 providersLoaded 消息协议、webview UI 消费标记做区分展示、并跟踪『后续权威拉取仍缺失』的跨轮次状态，改动横跨消息协议与 UI，超出低级别条目的合理修复边界。按批次指示在 mergeConfiguredProviders 处新增详细中文注释：说明兜底的设计目标（临时空窗不闪断，有测试锁定）、已知局限（无法区分持久性加载失败、failed 字段被固定为空）、以及未来若有实际反馈时的完整实现路径（附标记→协议→UI），并明确不应通过收紧兜底来解决（会重新引入空窗闪断）。

**修改文件**：`packages/kilo-vscode/src/provider-actions.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/provider-actions-save.test.ts：39 pass 0 fail（注释无行为变化，既有兜底测试锁定行为不变）

**问题描述**：fetchProviderList 的 connected 模式把 /config/providers 返回的全部 provider 视为 connected，mergeConfiguredProviders 再把后端未返回但存在于 config 的自定义 provider（sanitize 通过即可）补入 all 与 connected。对'后端注册表临时空窗'这是正确的特性（有测试覆盖），但当某自定义 provider 因后端持久性原因无法加载（npm 包加载失败、运行时初始化异常）时，扩展端仍将其展示为已连接并列出 config 中的模型，用户可选中一个后端实际无法服务的模型，错误被推迟到发送消息时才暴露，且上游通过 provider.list 的 failed 字段区分失败 provider 的能力在 connected 模式下被固定为空数组。

**修复建议**：对 config 兜底注入的 provider 附加标记（如 filled: true），或在后续权威拉取仍缺失时在 UI 上区分展示，避免持久性故障被'临时空窗'语义掩盖。


### F21【低/质量】首次连接时 refreshConnectionData 被 initializeConnection 与 SSE connected 回调各执行一次，产生双份全量拉取

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/KiloProvider.ts:1635`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：refreshConnectionData 新增按 connectionGeneration 去重：新增字段 refreshedConnectionGeneration，进入时（通过连接态检查后）标记，同一 generation 只执行一次全量拉取；进入时而非完成后标记是因为首连的两条调用路径（onStateChange connected 回调与 initializeConnection 尾部）会重叠执行。重连场景 connectionGeneration 必然递增（onStateChange 状态变化或重新初始化），刷新照常执行，既有重连刷新行为不破坏（provider-connection-refresh-source.test.ts 锁定的两处调用点均保留）。新增 3 个测试：同代重复调用只拉一次、generation 递增后重新拉取、未连接调用不消耗当前代的刷新机会。

**修改文件**：`packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/tests/unit/kilo-provider-connection-refresh.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/kilo-provider-connection-refresh.test.ts tests/unit/provider-connection-refresh-source.test.ts：均通过

**问题描述**：上游只在 initializeConnection 尾部做一次 9 项并行拉取；改动后 onStateChange 的 connected 分支（1635 行）与 initializeConnection 尾部（1721 行）都调用 refreshConnectionData。首连时两条路径几乎总是先后触发，agents/skills/commands/config/notifications 等接口各拉两遍，extensionDataReady 发送两次（webview 端 unsubReady 一次性订阅可容忍，但 gitStatus/统计轮询等也重复执行）。providers 拉取有 coalescing 去重，其余没有。重连场景下由 connected 回调刷新是新增的正确行为，但首连的重复开销在 Remote-SSH 场景下不可忽略。

**修复建议**：为 refreshConnectionData 增加按 connectionGeneration 的去重（同一 generation 只执行一次），或在 initializeConnection 中检测 connected 回调是否已完成本轮刷新。


### F22【低/质量】Kilo provider 长期缺失时 scheduleProviderRetry 无限轮询并重复向 webview 推送相同全量快照

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/KiloProvider.ts:2415`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：两项改进：1）PROVIDER_RETRY_DELAYS 尾部追加 120s/300s 档，长期缺失时封顶间隔从 30 秒放宽到 5 分钟，大幅降低无效请求量，同时保留『缺失最终自愈』语义（未设次数上限，避免破坏 F02 的 kilo 缺失重试行为，短期缺失仍走 1s/3s/10s/30s 快速恢复）；2）新增 providersRetryPass 标记，仅 scheduleProviderRetry 触发的后台自愈重试轮次在拉取结果与 cachedProvidersMessage 内容一致（sameProvidersSnapshot 归一化 revision 后比较）时跳过重复 postMessage，缓存仍更新为最新消息供离线回放；webview 主动请求（requestProviders 含冷启动重试）与排队合并场景始终推送，避免冷启动 webview 因缓存命中永远拿不到快照。sameProvidersSnapshot 为 kilo-provider-utils.ts 纯函数并配单测；F02 既有测试『首轮成功但缺少 Kilo 时会自动退避重试直到免费模型出现』保持通过。

**修改文件**：`packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/src/kilo-provider-utils.ts`、`packages/kilo-vscode/tests/unit/kilo-provider-providers-refresh.test.ts`、`packages/kilo-vscode/tests/unit/kilo-provider-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/kilo-provider-providers-refresh.test.ts tests/unit/kilo-provider-utils.test.ts：95 pass 0 fail

**问题描述**：connected 拉取成功但结果缺少 kilo 且 expectsKiloProvider() 为真时，会以封顶 30 秒的间隔无限重试；每次重试成功都会 postMessage 一份 providersLoaded（revision 未变，webview 端 revision 相等被接受并整体替换 state，触发信号更新与重渲染）。当用户环境确实无法访问 Kilo gateway（网络策略封锁等）时，这个自愈循环永不终止：每 30 秒 4 个 HTTP 请求加一次全量消息推送，没有次数上限，也没有'数据未变化则不推送'的判断。

**修复建议**：为'拉取成功但缺 kilo'的场景设置重试次数上限或更长的封顶间隔，并在快照内容与 cachedProvidersMessage 相同时跳过 postMessage。


### F23【低/缺陷】normalizeCustomProviderBaseURL 会把 Gemini /v1alpha 结尾的 baseURL 误补成 /v1alpha/v1beta

- **域**：shared-helpers
- **位置**：`packages/kilo-vscode/src/shared/provider-model.ts:22`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：provider-model.ts 将 @ai-sdk/google 的 suffixPattern 从 /\/v1(?:beta)?$/i 放宽为 /\/v1(?:beta|alpha)?$/i，以 /v1alpha 结尾的 Gemini baseURL 视为已带版本段原样保留，不再被误补成 /v1alpha/v1beta。附中文注释说明 v1/v1beta/v1alpha 三个版本段的处理规则。

**修改文件**：`packages/kilo-vscode/src/shared/provider-model.ts`、`packages/kilo-vscode/tests/unit/custom-provider-defaults.test.ts`、`packages/kilo-vscode/tests/unit/fetch-models.test.ts`

**测试**：bun test tests/unit/custom-provider-defaults.test.ts tests/unit/fetch-models.test.ts 全部通过。新增用例：normalizeCustomProviderBaseURL 对 /v1alpha、/v1beta、/v1 结尾原样保留；fetchModels 对 /v1alpha 结尾的 baseURL 请求路径为 /v1alpha/models 的端到端回归。

**问题描述**：@ai-sdk/google 的 suffixPattern 为 /\/v1(?:beta)?$/i，只放行 /v1 与 /v1beta 结尾。Gemini 实际还提供 v1alpha API 版本（实验特性入口），用户填写 https://generativelanguage.googleapis.com/v1alpha 时会被规范化为 .../v1alpha/v1beta，模型发现与后续请求均 404，且用户难以从 "HTTP 404" 错误中定位原因。

**修复建议**：将 suffixPattern 放宽为 /\/v1(?:beta|alpha)?$/i，或改为通用的版本段检测（如 /\/v\d+[a-z]*$/i）后仅在无版本段时追加默认 /v1beta。


### F24【低/质量】fetchGeminiModels 未按 supportedGenerationMethods 过滤，候选列表混入不可聊天的模型

- **域**：shared-helpers
- **位置**：`packages/kilo-vscode/src/shared/fetch-models.ts:248`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：fetchGeminiModels 在 map 前新增 geminiChatCapable 过滤：supportedGenerationMethods 包含 generateContent 或 streamGenerateContent 才进入候选列表，排除 embedding/imagen/veo/tts 等不可聊天模型；字段缺失或非数组时保守放行，兼容不返回该字段的非官方网关。

**修改文件**：`packages/kilo-vscode/src/shared/fetch-models.ts`、`packages/kilo-vscode/tests/unit/fetch-models.test.ts`

**测试**：bun test tests/unit/fetch-models.test.ts 通过。新增用例覆盖：generateContent 保留、仅 streamGenerateContent 保留、embedContent 与 predict 排除、字段缺失放行。

**问题描述**：Gemini /v1beta/models 返回的条目包含 embedding、imagen、veo、tts 等不支持 generateContent 的模型，当前实现全部映射进候选列表。虽然交互上默认不全选降低了误选概率，但用户仍可能添加 embedding 类模型，保存后在聊天中发送请求才失败，报错位置远离出错原因。

**修复建议**：在 map 前按 item.supportedGenerationMethods 包含 "generateContent"（或 "streamGenerateContent"）过滤；字段缺失时保守放行以兼容非官方网关。


### F25【低/质量】Gemini 发现路径缺少 Anthropic 同款的 baseURL 防御，且 /v1 尾缀判断逻辑重复实现

- **域**：shared-helpers
- **位置**：`packages/kilo-vscode/src/shared/fetch-models.ts:234`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：在 provider-model.ts 新增共享 helper normalizeProtocolBaseURL（协议→代表性包名映射后复用 normalizeCustomProviderBaseURL，规则单点维护且幂等）；fetchModels 入口统一按 protocol 做 baseURL 防御性规范化，随后 anthropic/gemini 分支只做纯 /models 拼接；删除 anthropicModelsURL 私有函数的重复 /v1 尾缀判断（模块内未导出符号，不违反导出兼容原则）。Gemini 发现路径由此获得与 Anthropic 同款防御：未来调用方漏掉规范化时请求也会打到 /v1beta/models 而非根路径 /models。

**修改文件**：`packages/kilo-vscode/src/shared/provider-model.ts`、`packages/kilo-vscode/src/shared/fetch-models.ts`、`packages/kilo-vscode/tests/unit/fetch-models.test.ts`、`packages/kilo-vscode/tests/unit/custom-provider-defaults.test.ts`

**测试**：bun test tests/unit/fetch-models.test.ts tests/unit/custom-provider-defaults.test.ts tests/unit/custom-provider-model-fetch.test.ts 全部通过。新增断言：Gemini 无版本段 baseURL 的请求路径锁定为 /v1beta/models；normalizeProtocolBaseURL 三种协议的规则与按包名版本一致且幂等。

**问题描述**：anthropicModelsURL（第 169-173 行）会为未带 /v1 的 baseURL 自动补 /v1/models，与 provider-model.ts 的 normalizeCustomProviderBaseURL 重复实现了同一套尾缀规则；而 fetchGeminiModels 直接拼 {baseURL}/models，完全依赖调用方（目前仅 CustomProviderDialog.tsx 在 webview 侧）先执行规范化。KiloProvider.handleFetchCustomProviderModels 直接信任消息里的 baseURL，未来任何新调用点（或恢复出厂的消息路径变更）漏掉规范化时，gemini 请求会打到根路径 /models 得到 404，行为与 anthropic 分支不一致。

**修复建议**：在 fetchModels 入口按 protocol 统一调用 normalizeCustomProviderBaseURL（或等价共享函数），随后各分支只做纯 /models 拼接，删除 anthropicModelsURL 的重复判断。


### F26【低/架构】withCustomProviderDeletions 与 providerReset 存在未显式化的成对调用契约

- **域**：shared-helpers
- **位置**：`packages/kilo-vscode/src/shared/custom-provider.ts:285`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：采用合并入口方案显式化契约：custom-provider.ts 新增导出 customProviderConfigPatches(existing, next) 返回 { reset?, patch }，文档注释（中文）明确两步应用顺序与跳过 reset 的后果；providerReset 与 withCustomProviderDeletions 两个旧导出原样保留（兼容既有调用方）并各自补充中文契约注释；按审核建议删除 limitPatch/costPatch 未使用的 oldModel 参数并注明其依赖 providerReset 先行；导出 ResetPatch/ProviderPatch 类型供调用方使用。provider-actions.ts 的 saveCustomProvider 改用新入口，先清后写与失败回滚逻辑不变。

**修改文件**：`packages/kilo-vscode/src/shared/custom-provider.ts`、`packages/kilo-vscode/src/provider-actions.ts`、`packages/kilo-vscode/tests/unit/custom-provider.test.ts`

**测试**：bun test tests/unit/custom-provider.test.ts tests/unit/provider-actions-save.test.ts tests/unit/provider-action.test.ts 全部通过（含既有 reset-then-patch 顺序与失败回滚用例）。新增 describe(customProviderConfigPatches) 3 个用例：limit 子字段删除时返回的 reset/patch 与旧成对入口输出一致、无需重置时不含 reset 键、cost 子字段删除场景。另：本批次相关 6 个测试文件共 127 pass 0 fail；kilo-vscode 包 tsc --noEmit 无错误。全量 tests/unit 存在 1 个与本批次无关的既有失败（worktree-manager.test.ts 的 returns bare branch + remote when remote exists，因本机环境下真实 git fetch 失败回退 local-tracking；该测试与 WorktreeManager 源文件均未被修改，依赖链不含本批次任何文件）。

**问题描述**：limit/cost 子字段的删除（如旧 limit 有 input 而新 limit 没有）不再由主 patch 用 null 哨兵表达：limitPatch/costPatch（第 285-291 行）接收 oldModel 参数却完全不使用，实际只透传新值；子字段清理完全依赖调用方先应用 providerReset 返回的整体 null 重置（两次独立的 config.update）。当前 provider-actions.ts:775 正确地成对调用并带失败回滚，但该契约没有类型或运行时保障，未来调用方单独使用 withCustomProviderDeletions 时，被删除的 limit.input、cost.cache_read 等子字段会在 deep-merge 后残留在磁盘配置中，且不会有任何报错。

**修复建议**：将两个函数合并为一个返回 { reset?: ResetPatch; patch: ProviderPatch } 的入口以显式化契约；至少删除 limitPatch/costPatch 中未使用的 oldModel 参数并在函数注释中说明必须先应用 providerReset。


### F27【低/回归】删除上游 Popular providers 快捷连接区块

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx:277`
- **级别**：审读 medium → 验证修正为 **low**
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：在 README.md「主要改进 > UI 页面自定义提供商增强」补记决策：功能表新增「设置主页精简」一行，关键实现列表新增一条完整说明——移除上游 Popular providers 快捷连接区块是有意的 UI 决策（设置主页聚焦自定义 Provider 入口、压缩页面高度），热门 provider 经「Add provider」弹窗（ProviderSelectDialog）仍可连接并按推荐分组置顶（popularProviderIndex + settings.providers.group.recommended），决策由 tests/unit/providers-tab-source.test.ts 锁定，providerNoteKey 依维护原则第 5 条保留兼容壳。未触碰 README 中 fetchAndSendAgents/filterAgents 描述段落（F54 归属另一批次）。

**修改文件**：`README.md`

**测试**：文档改动无需单独测试；providers-tab-source.test.ts 随本批次一并运行通过（见 F28）

**问题描述**：ProvidersTab 移除了上游设置主页的 Popular providers 列表（含 providerNoteKey 备注展示与一键 Connect 按钮），改为仅保留自定义 Provider 入口；热门内置 provider 现在只能通过 Add provider 打开的 ProviderSelectDialog 连接。功能仍可达但上游原有 UI 流程被删除，属于自定义 Provider 增强边界之外的上游功能变更，README 主要改进章节未记载该决策（仅 providers-tab-source.test.ts 锁定），且 settings.providers.section.popular 等 i18n key 成为孤儿键；该文件的大段删除也会扩大后续上游合并的冲突面。

**修复建议**：在 README 维护原则/主要改进中明确记载该 UI 决策及动机；或改为条件渲染（隐藏而非删除代码块）以缩小对上游文件的 diff 面并清理孤儿 i18n key。

**验证结论**：事实全部属实：git diff v7.4.16..HEAD 确认 ProvidersTab.tsx 删除 popularProviders memo 与渲染区块（2 增 68 删），provider-catalog.ts 删除 providerNoteKey 导出——后者直接违反 README.md 第 31 行维护原则第 5 条『不删除、不重命名上游导出符号』；settings.providers.section.popular（30+ 语言文件）与 settings.providers.note.kilo 均已无 UI 引用成为孤儿键，sortProviders 在产品代码中也无使用者（仅测试引用）；README 主要改进章节（20-60 行）确无该决策记载。但严重级别应下调为 low：这是有意决策而非意外回归——tests/unit/providers-tab-source.test.ts 明确锁定『keeps popular providers out of the main settings page』并要求 ProviderSelectDialog 保留 popularProviderIndex 与 settings.providers.group.recommended 分组；ProvidersTab.tsx:327-329 保留『Show more providers』一键入口，热门 provider 在弹窗中置顶分组，功能可达性无实质损失；该改动自 fork 初始化提交 63171e23ad 即存在并已平安经历一次上游升级合并（dad62847c3），冲突面属已知已管理。剩余可操作项仅为 README 补记与孤儿键/死导出清理，属维护性问题而非功能缺陷。


### F28【低/入侵性】删除上游导出符号 providerNoteKey，违反 README 维护原则 5

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts:46`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：在 packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts 按上游 v7.4.16 原实现恢复导出 providerNoteKey（含 metadata.noteKey 优先、字符串 kilo ID 返回 settings.providers.note.kilo、其余返回 undefined 三个分支），并加中文 JSDoc 说明这是遵守 README 维护原则第 5 条（不删除上游导出符号）保留的兼容壳、「不再展示 note」的决策留在调用侧。新增 3 个测试锁定兼容壳行为与上游一致。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/settings/provider-catalog.ts`、`packages/kilo-vscode/tests/unit/provider-catalog.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/provider-catalog.test.ts → 6 pass / 0 fail；连同 providers-tab-source.test.ts 等 5 个相关文件合跑 108 pass / 0 fail

**问题描述**：v7.4.16 中 provider-catalog.ts 导出的 providerNoteKey 函数被整体删除。README 维护原则第 5 条要求'不删除、不重命名上游导出符号；需要改变行为时保留兼容壳'。当前仓库内已无引用因此不产生编译错误，但下次上游合并时若上游新增该符号的调用点会直接冲突/报错。

**修复建议**：保留 providerNoteKey 的兼容导出（即使当前无调用方），把'不再展示 note'的决策留在调用侧（ProvidersTab）而非删除共享导出。


### F29【低/质量】apply/flag/field 与 mergeModelDefaults 重复实现同一'只补空字段'语义

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx:475`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：删除 dialog 内与 CustomProviderDefaults 同名同义的 flag()/field() 双实现，apply() 改为经 autoFillModel 内部调用 mergeModelDefaults 后把完整结果对象经 setForm("models", i, next) 浅合并写回（与既有 choose() 相同的 Solid store 写入 pattern，值未变化的键 Solid 自动跳过更新），variants 注入时同步重置 errors 的 variants 数组。'只补空字段'不变量现在只有 mergeModelDefaults 一个实现点，且被单元测试覆盖；手输 ID 路径与自动发现路径行为不可能再漂移。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx`、`packages/kilo-vscode/tests/unit/custom-provider-defaults.test.ts`、`packages/kilo-vscode/tests/unit/custom-provider-dialog-source.test.ts`

**测试**：同 F04 测试命令，69 pass 0 fail；autoFillModel 测试断言合并结果与 mergeModelDefaults 输出完全一致（同一实现点）；源码断言测试锁定 dialog 内不再存在 function flag(/function field( 双实现

**问题描述**：dialog 内的 flag()/field()/apply()（462-502 行）与 CustomProviderDefaults.ts 的 flag()/field()/mergeModelDefaults()（64-152 行）是同名同义的两套实现：都实现'boolean 只在未开启时补、文本只在为空时补、有 variants 强制 reasoning、有任一价格开启 costEnabled'。README 明确把'内置默认值只补空字段'列为关键不变量，双实现一旦漂移（例如只改其一）会导致自动发现路径（mergeModelDefaults）与手输 ID 路径（apply）行为不一致，且只有前者被单元测试覆盖。

**修复建议**：apply() 改为 setForm("models", i, mergeModelDefaults(form.models[i], defaults)) 并同步重置 variants 错误数组；删除 dialog 内重复的 flag/field helper，让该不变量只有一个实现点并被现有测试覆盖。


### F30【低/缺陷】choose()/apply() 更新字段值后不清除对应的旧校验错误

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx:537`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：新增 clearModelErrors helper：apply() 按 autoFillErrorKeys(record)（下沉到 CustomProviderDefaults.ts 的纯函数，只返回本次实际写入的数值字段）清除对应字段旧校验错误；回收路径 revert() 同样清除被回收字段的错误；choose() 因 replaceModelDefaults 全量覆盖 limit/cost 字段，按 MODEL_VALUE_ERROR_KEYS 清除该行全部数值字段错误（variants 错误重置为既有行为）。错误提示不再悬挂在已被替换为合法值的输入框旁。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx`、`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDefaults.ts`、`packages/kilo-vscode/tests/unit/custom-provider-defaults.test.ts`、`packages/kilo-vscode/tests/unit/custom-provider-dialog-source.test.ts`

**测试**：同 F04 测试命令，69 pass 0 fail；autoFillErrorKeys 有独立纯函数测试；源码断言测试锁定 apply/choose 的两处 clearModelErrors 调用

**问题描述**：提交失败后 errors.models[i] 会带上 contextLimit/inputCost 等字段错误文案；此时点击候选模型，choose() 用 replaceModelDefaults 覆盖了这些字段的值，但只重置了 errors...variants，limit/cost/id 等旧错误文案仍显示在已被替换为合法值的输入框旁，直到下一次提交才消失。apply() 同理。

**修复建议**：choose()/apply() 在写入模型字段的同时清空该模型条目的字段级错误（或对该行重新跑 checkModel），保证错误提示与当前值一致。


### F31【低/质量】addSelected 中重复设置 fetch.added 状态

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx:727`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：删除 addSelected 中第一处（toAdd.length > 0 分支内）冗余的 setFetchStatus(fetch.added) 调用，只保留后面统一状态分支里的那一次；顺带在同一位置补充了 empty 替换空行时清空行级局部状态的注释与处理（配合 F04 的行状态维护）。dialog 源码中 provider.custom.models.fetch.added 现在只出现一次，由源码断言测试锁定防止回归。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx`、`packages/kilo-vscode/tests/unit/custom-provider-dialog-source.test.ts`

**测试**：bun test tests/unit/custom-provider-dialog-source.test.ts（断言 fetch.added 文案在源码中只出现一次）通过；相关既有测试 custom-provider.test.ts / custom-provider-model-fetch.test.ts 55 pass 0 fail 无回归

**问题描述**：addSelected() 在 727 行与 742 行对同一条件（toAdd.length > 0）重复调用了 setFetchStatus(provider.custom.models.fetch.added)，两处文案参数完全相同；727 行这次是引入候选推荐逻辑时遗留的冗余写入。无功能影响，但会误导后续维护者以为两处状态含义不同。

**修复建议**：删除 727 行的那次 setFetchStatus，保留 740-751 行统一的状态分支。


### F32【低/缺陷】auth 状态在组件初始化时一次性快照，非响应式

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx:261`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：按审核建议采用最低风险方案：const auth = resolveAuth(...) 一次性快照改为 createMemo(() => resolveAuth(props.existing, provider.authStates()))，JSX 中 auth === "api" 改为 auth() === "api"（全文件仅此一处使用）。authStates 在对话框打开后才到达时，'已保存 key'占位提示（apiKey.placeholder.saved）现在能正常显示。resolveAuth 本身是既有纯函数未改动；组件无法在无 DOM 的 bun 环境挂载渲染，故用源码断言测试锁定 createMemo 包装与 auth() 调用形式，防止回归为快照。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx`、`packages/kilo-vscode/tests/unit/custom-provider-dialog-source.test.ts`

**测试**：bun test tests/unit/custom-provider-dialog-source.test.ts 通过；bun x tsc --noEmit --project webview-ui/tsconfig.json 通过

**问题描述**：const auth = resolveAuth(props.existing, provider.authStates()) 在组件 setup 阶段同步读取 signal，不在任何响应式作用域内；若 authStates 在对话框打开后才到达（首次打开设置页较快进入编辑时可能发生），API key 输入框不会显示'已保存 key'占位提示（apiKey.placeholder.saved），退化为普通占位文案。仅影响提示展示，不影响保存语义。

**修复建议**：改为 createMemo(() => resolveAuth(props.existing, provider.authStates())) 并在 JSX 中调用 auth()。


### F33【低/质量】新增 i18n key 仅覆盖 en/zh/zht 三个语言文件

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/i18n/en.ts`
- **验证**：未单独验证（低级别）
- **处理状态**：**接受现状**

**处理记录**：按批次指示接受现状。核实：i18n-keys.test.ts 的键一致性校验本就只覆盖 en/zh/zht 三个语言文件（属有意的豁免设计，其余 17 个 locale 不在校验范围），language.tsx 提供英文回退机制，功能不受影响，非中英用户仅在该表单看到中英混排。为 17 个 locale 补机器翻译条目会显著扩大 ZLF 补丁面并增加每次上游合并的冲突成本，与 README 维护原则'ZLF 补丁最小化'相悖。完整方案（若后续需要）：为其余 locale 批量补机器翻译，或在 README i18n 约定中明文记载'ZLF 新增 key 只维护 en/zh/zht，其余回退英文'。

**测试**：bun test tests/unit/i18n-keys.test.ts 通过（en/zh/zht 键一致性豁免设计确认存在）

**问题描述**：本域新增的 key（provider.custom.models.contextLimit/outputLimit/cost 系列、defaults 系列、fetch.privateHost、error.tokenLimit、error.cost、apiKey.placeholder.saved、variants.default.label、reasoningEffort.max 等）只写入了 en.ts、zh.ts、zht.ts；其余 17 个 locale 依赖 language.tsx 的英文回退。功能不受影响，但非中英用户在该表单会看到中英混排界面，与上游各 locale 全量覆盖的惯例不一致。

**修复建议**：若维护成本可接受，为其余 locale 至少补机器翻译条目；否则在 README/i18n 约定中记载'ZLF 新增 key 只维护 en/zh/zht，其余回退英文'。


### F34【低/架构】CustomProviderDialog 组件过大，应进一步拆分

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx:249`
- **验证**：未单独验证（低级别）
- **处理状态**：**接受现状**

**处理记录**：按批次指示接受现状。CustomProviderDialog.tsx 当前约 1500 行，拆出 DefaultCandidatePanel、CandidatePreview 展示组件和 createModelDiscovery 状态机 primitive 属高风险架构重构：涉及大量 props 边界重新设计、doFetch 的 ack/超时/版本控制状态机迁移，且该组件是本轮多个缺陷修复（F04/F29/F30 等）的落点，重构与缺陷修复叠加会显著增加回归风险。留待后续独立变更集处理。本批次已通过把 F04/F29/F30 的核心逻辑下沉为 CustomProviderDefaults.ts 纯函数，部分缓解了'组件难以单独测试'的问题。

**测试**：无（未改动代码）

**问题描述**：当前单文件 1472 行，单组件同时承担：表单 store 管理、模型发现状态机（doFetch/ack/超时/版本控制）、默认值应用、候选推荐派生、hover 预览弹层定位与渲染、模型选择器渲染。候选面板（约 1120-1250 行）与预览弹层（约 1400-1466 行）是纯展示块，doFetch 状态机是独立的消息协议逻辑，混在一起使组件难以单独测试（目前只能靠源码文本测试和纯函数测试间接覆盖）。

**修复建议**：拆出 DefaultCandidatePanel 与 CandidatePreview 两个展示组件（props 传入 items/defaults 与回调），并把 doFetch 的 ack/超时/版本状态机抽成独立的 createModelDiscovery(vscode, options) primitive，便于对超时与过期响应路径做直接单元测试。


### F35【低/回归】全局配置 PATCH 不再销毁实例，Agent/MCP 等配置派生缓存不会失效

- **域**：hot-reload
- **位置**：`packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts:93`
- **级别**：审读 medium → 验证修正为 **low**
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：与 F06 为同一问题，同一修复：非 provider 键变化的全局配置 PATCH 恢复 disposeAllInstancesAndEmitGlobalDisposed，MCP/Command/Plugin 等构建期快照配置的实例级服务经重建感知新配置；provider 段变化仍走热更新不销毁。legacy-migration 写 mcp 段等 SDK 调用方的失效通道恢复。

**修改文件**：`packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`、`packages/opencode/test/kilocode/global-config-refresh.test.ts`

**测试**：同 F06：global-config-refresh.test.ts 5 pass（含新增 mcp 段销毁测试）

**问题描述**：configUpdate 删除了 v7.4.16 基线中 result.changed 时的 disposeAllInstancesAndEmitGlobalDisposed 调用，config.ts 的 reset() 只失效 Config 自身的 InstanceState 并发事件。Provider 域靠 current() 的快照比较自愈，但 Agent（agent.ts:121 在 state 构建器里读 config.get() 并缓存 agent/permission 派生结果）、MCP 等服务的 InstanceState 无 TTL、无 global.config.updated 订阅，只能靠实例销毁失效。扩展端仅在 provider connect/oauth 流程调用 disposeGlobal（provider-actions.ts:605/661），普通设置保存不再触发销毁——通过 API 修改 agent、permission、mcp 等非 provider 配置后，活动实例的后端行为可能保持旧值直到重启。global-config-refresh.test.ts 已把该行为改动固化为预期，但只验证了 provider 键的自愈。

**修复建议**：在 configUpdate（或 updateGlobal）中利用 ConfigRefresh.diff()：仅 provider 段变化时走现有热更新；diff 返回 undefined（含非 provider 键变化）时保留原销毁语义，或为 Agent/MCP 等 InstanceState 增加 global.config.updated 失效订阅，并补充一条非 provider 配置（如 agent 段）PATCH 后生效的测试。

**验证结论**：部分属实但关键论据有误、严重级别夸大。属实部分：(1) 基线 v7.4.16 的 configUpdate 在 result.changed 时调用 disposeAllInstancesAndEmitGlobalDisposed（git show 确认），HEAD 的 global.ts:93-98 已删除；(2) Config.reset()（config.ts:979-982）只失效 Config 自身 InstanceState；(3) MCP 服务确无自愈——mcp/index.ts:480-545 在 state 构建器读 cfg.mcp 建立 clients，全文无 InstanceState.invalidate，status/tools 等接口（573/637 行等）全走缓存 state，服务端也无 global.config.updated 订阅者（该事件仅 TUI 客户端 tui-config-hot-reload.ts:46 订阅）。误读部分：Agent 并非"只能靠实例销毁失效"——agent.ts:527-534 的 current() 在每次 get/list/defaultInfo 访问时用 KiloAgent.cacheKey(cfg) 比较并自动 invalidate 重建，cacheKey（kilocode/agent/index.ts:291-302）覆盖 agent、default_agent、mcp、mode、permission、references 等键，即 agent/permission 配置变更是有自愈的。此外遗漏关键缓解：扩展设置保存的主路径走 overlayUpdate（config-console.ts:81-89），global scope 非 console 键变更时仍显式调用 disposeAllInstancesAndEmitGlobalDisposed，保留销毁语义。PATCH /global/config 的实际调用方仅剩 provider-actions.ts（provider 域有快照自愈）和 legacy-migration/migration-service.ts:204（迁移写 mcp 段，之后无 disposeGlobal，活动实例的 MCP 客户端确实不会刷新）及外部 SDK 用户。问题真实存在（MCP/Command/Plugin 等派生缓存对该公开 API 无失效通道）但暴露面远小于描述，降为 low。


### F36【低/回归】authSet/authRemove 改为 fire-and-forget 失效，成功返回不保证认证已生效

- **域**：hot-reload
- **位置**：`packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts:22`
- **级别**：审读 medium → 验证修正为 **low**
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：control.ts 的 authSet/authRemove 恢复同步等待 invalidateAfterProviderAuthChange（该函数现仅做内存级 ModelCache.clear + ModelsRefresh.notify，同步开销可忽略），恢复「返回即生效」语义，移除 bridge.fork 与 EffectBridge 依赖；保留 catchCause 告警使缓存失效的意外失败不让已落盘的认证写入报 500（失效可由后续读取自愈）。

**修改文件**：`packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts`、`packages/opencode/test/kilocode/server/provider-auth-lifecycle.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/server/provider-auth-lifecycle.test.ts → 2 pass / 0 fail

**问题描述**：invalidate() 用 bridge.fork 异步执行 invalidateAfterProviderAuthChange，HTTP 在 ModelCache.clear 和 ModelsRefresh.notify 完成前即返回 true。auth 变更不改配置快照，current() 的 cached.config === cfg 检查不会察觉，Provider 状态刷新完全依赖这个 forked fiber：若 fork 中 ModelCache.clear 失败（仅 warn 日志），所有实例将无限期持有旧 API key；即便成功，调用方在响应后立即发起的请求也可能命中旧 key。该路径对所有 provider（含内置 anthropic/openai/kilo 的 key 更新）生效，而 v7.4.16 基线是同步清缓存并销毁全部实例。同时 provider-auth-lifecycle.ts:42 的 _options.timeout 是死参数——control.ts 传入 "5 seconds" 但函数体已不再调用带 timeout 的 disposeAll，容易误导后续维护者。

**修复建议**：至少将 ModelCache.clear + ModelsRefresh.notify 改回同步等待（两者本身很快，不涉及 Remote-SSH 断连问题），仅把重量级操作留在 fork 中；删除或真正消费 invalidateAfterProviderAuthChange 的 timeout 参数。

**验证结论**：事实描述准确但严重级别夸大。属实部分：(1) control.ts:22-34 的 invalidate() 经 bridge.fork 执行，bridge.ts:77-78 确认 fork = Effect.runFork 不等待，HTTP 在 ModelCache.clear + ModelsRefresh.notify 完成前返回 true，而基线 v7.4.16 是同步 `yield* invalidateAfterProviderAuthChange(...)` 且当时该函数含 disposeAll；(2) provider-auth-lifecycle.ts:42 的 `_options?: { timeout }` 确为死参数，函数体（44-48 行）不再消费，control.ts:27 仍传 "5 seconds"，误导维护者属实；(3) auth 不改配置快照，provider.ts:1713 的 `cached.config === cfg` 检查确实察觉不到。夸大部分：(a) 所有一方客户端均有兜底——VS Code connectProvider 在 auth.set 后 `await ctx.disposeGlobal()`（provider-actions.ts:604-605，经 POST /global/dispose 同步销毁全部实例），TUI 在 auth.set 后 `await sdk.client.instance.dispose()` 再 bootstrap（dialog-provider.tsx:392-401），自定义 Provider 保存伴随 provider 段配置变化、经 Provider 快照自愈在 config-refresh.ts:183-186 重读 auth 取新 key；(b) "ModelCache.clear 失败导致无限期持有旧 key"过于理论化——clear（model-cache.ts:343-357）与 detach（204-216 行）均为纯内存 Effect.sync 操作，几乎不可能失败，且 notify（models-refresh.ts:8-12）对每个 listener 失败单独 Effect.exit 捕获后继续；(c) 竞态窗口是毫秒级内存操作对网络往返，实际命中概率极低。剩余风险仅为直接使用 SDK 的第三方调用方与死参数的可维护性问题，降为 low。


### F37【低/缺陷】多 env var 时 key 解析与全量构建分叉，热更新与重启后行为不一致

- **域**：hot-reload
- **位置**：`packages/opencode/src/kilocode/provider/config-refresh.ts:186`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：随 F10 统一自动消除：refresh() 的 key 解析改用共享 resolveEnvApiKey（全量语义：任一 env var 有值即视为找到；仅声明恰好一个 env var 时注入值，多个时 key 置 undefined 交由 SDK 自行读取），provider.ts 的 env 循环同样改调该函数（kilocode_change 标记，行为不变）。对拍测试中声明两个 env var 并断言增量产物 key 为 undefined（红-绿验证：回退为 find(Boolean) 后对拍测试失败）；另增「单 env var 的 Provider 热更新后保留 env 注入的 key」测试确认单 env 场景未被破坏。

**修改文件**：`packages/opencode/src/kilocode/provider/compile.ts`、`packages/opencode/src/kilocode/provider/config-refresh.ts`、`packages/opencode/src/provider/provider.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/provider-config-refresh.test.ts → 17 pass 0 fail

**问题描述**：refresh() 用 entry?.env?.map((name) => env[name]).find(Boolean) 取第一个非空 env 值作为 provider.key；而 provider.ts:1552 的全量构建在 provider.env.length !== 1 时刻意置 key 为 undefined（交由 SDK 自行读取环境变量）。配置了两个及以上 env var 的自定义 Provider 在热更新后 key 有值、重启后 key 为 undefined，resolveSDK 注入 apiKey 的行为随之不同，可能出现"保存后能用、重启后失效"（或相反）的难排查问题。这是 build() 手工复制全量构建逻辑（约 90 行）已经产生的第一处行为分叉。

**修复建议**：对齐全量构建语义：entry.env 长度为 1 时才取 env 值，否则 key 置 undefined；中期把 config-model 解析抽成两条路径共享的纯函数，消除复制。


### F38【低/缺陷】resolveSDK 无 single-flight，并发加载同 key 时 WebSocket transport 被覆盖泄漏

- **域**：hot-reload
- **位置**：`packages/opencode/src/provider/provider.ts:1801`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：resolveSDK 增加按 key 的 single-flight：State 新增 sdkLoads: Map<string, Promise<SDK>>，同 key 并发加载共享同一 Promise，加载结束（无论成败）由创建方清除条目、失败后可重试，消除并发双加载互相覆盖缓存及被覆盖方 WebSocket transport 永不 close 的泄漏。options.fetch 构建与 bundled/npm 加载逻辑逐行保留上游语义，仅结构上移入 loadPromise（kilocode_change 块内注释说明升级对照点）。新增集成测试「并发 getLanguage 对同一 SDK 只执行一次加载」（file:// 模块顶层延迟 100ms 制造并发窗口，globalThis 工厂调用计数断言为 1），并验证过区分性：临时禁用 single-flight 时该测试失败。

**修改文件**：`packages/opencode/src/provider/provider.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/provider-config-refresh.test.ts → 19 pass / 0 fail（含新增 single-flight 测试；已做变异验证）

**问题描述**：两个并发 getLanguage 在 SDK 尚未入缓存时都会走完 resolveSDK：双方都执行 KiloOpenAIWebSocket.create 并 s.websockets.set(key, ...)，后写覆盖先写，先创建的 transport 永远不会被 close()——其 pruneTimer interval 持续存在（unref 但不清理），已打开的连接只能等 idle prune。另外版本失配路径下（refresh 已 close 并移除 transport，但 in-flight 请求仍持有该 SDK），已 close 的 pool 再被 fetch 会新建 pool entry 并打开新 socket，而此时 pruneTimer 已被 clearInterval，该连接不再受 idle 清理管理，直至进程退出或服务端超时。影响有界（每次竞态泄漏一个 pool/连接），但属于新增资源语义对象缺少并发防护。

**修复建议**：s.websockets.set 前若已存在同 key 旧值先 close；或为 resolveSDK 按 key 增加 single-flight（Promise 缓存）；ws-pool close() 后可将后续 fetch 直接降级为 httpFetch。


### F39【低/质量】check 失败即全局 ModelsRefresh.notify()，会全量失效所有实例的 Provider 状态

- **域**：hot-reload
- **位置**：`packages/opencode/src/kilocode/provider/ready.ts:33`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：采纳建议的首选方案（仅失效当前实例）：Provider Interface 新增可选方法 invalidate（kilocode_change 标记，声明为可选以免破坏既有测试替身；实现为 InstanceState.invalidate(state)，只清当前目录条目），ready.check 失败路径改为调用 provider.invalidate() 替代全局 ModelsRefresh.notify()。调用方依赖评估：全仓 grep 确认 /provider/ready 端点仅被本仓测试引用，kilo-vscode 扩展源码无调用方，无人依赖其全局失效副作用；其他实例的配置变化由各自 current() 的配置引用比对兜底。model-cache recovered 等其他 notify 调用点不受影响。新增测试注册全局 ModelsRefresh listener 验证失败路径不再触发全局失效、且当前实例仍被失效重建（红-绿验证：回退为 notify 后该测试失败）。

**修改文件**：`packages/opencode/src/kilocode/provider/ready.ts`、`packages/opencode/src/provider/provider.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/provider-config-refresh.test.ts → 17 pass 0 fail（含既有 ready 场景测试不受影响）

**问题描述**：check() 第一次 inspect 不通过就调用 ModelsRefresh.notify()，该通知会 invalidateAll 每个活动实例的 Provider InstanceState，下次读取触发完整重建（含 custom loader、gitlab 模型发现等较重操作）。由于 current() 已在读取前同步配置快照，notify 只在极少数缓存不一致场景有价值；而 unexpected 语义要求调用方传入完整期望模型集合，若调用方传入子集（或有 bug），每次轮询 /provider/ready 都会触发一次全局全量重建，且无退避或节流。接口本身有 Authorization 保护，不构成安全问题，属于失败路径代价过高。

**修复建议**：将失败路径的失效范围缩小为当前实例（直接 invalidate 本实例 Provider state 而非全局 notify），或对 notify 加最小间隔节流；在接口描述中明确 modelIDs 必须是完整期望集合。


### F40【低/架构】增量守卫未考虑 plugin 注入场景，插件提供的 options 在热更新后丢失

- **域**：hot-reload
- **位置**：`packages/opencode/src/kilocode/provider/config-refresh.ts:176`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：实现了可靠检测而非仅注释记载：RefreshInput 新增可选字段 pluginAuthProviders（存在 plugin auth loader 的 Provider ID 集合），provider.ts current() 在配置变化时从 plugin.list()（InstanceState 缓存，开销可忽略）提取带 auth.loader 的 provider id 传入；refresh() 增量判定命中该集合的 id 直接回退完整重建，与 OAuth 检查同层。注释记载了其余插件注入途径为何无需额外检测：plugin provider.models hook 只作用于 models.dev 目录内 Provider（已被 !catalog[id] 守卫排除）；plugin config() hook 产物已合并进 config.get() 快照，diff() 对比的即合并结果。新增单元级测试直接调用 ConfigRefresh.refresh 验证：无插件注入时走增量返回 true，命中 pluginAuthProviders 时返回 false。

**修改文件**：`packages/opencode/src/kilocode/provider/config-refresh.ts`、`packages/opencode/src/provider/provider.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/provider-config-refresh.test.ts → 17 pass 0 fail

**问题描述**：增量判定只排除 catalog Provider 和 OAuth 认证。若某插件通过 auth.loader 为一个非 catalog 的 config Provider 提供 options（provider.ts:1569 的 plugin auth loader 分支：providers[id] 已存在时仅 patch options，source 保持 "config"，auth type 为 "api"），热更新会通过增量路径用 build() 重建该 Provider——build() 只合并 config.options，插件注入的 headers/options 全部丢失，直到下次全量重建。Kilo VS Code 的自定义 Provider 流程不受影响，但第三方 opencode 插件场景会出现热更新后行为退化。

**修复建议**：增量判定中额外排除存在对应 plugin.auth loader 的 providerID（与 OAuth 检查同层处理），或在 refresh 输入中传入 plugin 列表用于判定。


### F41【低/回归】authSet/authRemove 的失效改为后台 fork，且传入的 timeout 参数实际未生效

- **域**：upstream-touch
- **位置**：`packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts:26`
- **级别**：审读 medium → 验证修正为 **low**
- **验证**：CONFIRMED
- **处理状态**：**已修复**

**处理记录**：与 F36 同一问题的死参数面：移除 provider-auth-lifecycle.ts 中从未被消费的 _options?: { timeout } 参数（选择移除而非消费：函数已不再销毁实例、只做内存操作，超时保护无意义；移除可选参数不改变导出符号，唯一传参调用方 control.ts 已同步更新，另一调用方 anaconda-desktop/service.ts 本就不传参）。测试更新说明：原测试「accepts timeout options without disposing instances」因参数删除而移除，替换为「等待缓存清理与刷新通知全部完成后才返回」——用 Deferred 门控 clear 验证同步等待语义（clear 未完成前函数不得返回、不得提前 notify），覆盖强于原测试。

**修改文件**：`packages/opencode/src/kilocode/server/provider-auth-lifecycle.ts`、`packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts`、`packages/opencode/test/kilocode/server/provider-auth-lifecycle.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/server/provider-auth-lifecycle.test.ts → 2 pass / 0 fail；anaconda-desktop/service.test.ts 回归通过

**问题描述**：上游在 auth set/remove 返回前同步执行 invalidateAfterProviderAuthChange（当时该函数还会 disposeAll 实例）。现在改为 bridge.fork 后台执行，HTTP 返回 true 时缓存可能尚未失效：调用方在 authSet 成功后立即请求 /provider 列表，可能拿到不含新认证 Provider（或仍含已移除 Provider）的旧注册表，产生时序竞态。另外 control.ts 传入 { timeout: "5 seconds" }，但 provider-auth-lifecycle.ts 中 invalidateAfterProviderAuthChange 的第二参数是 _options 且从未使用（现在的实现只做 cache.clear + ModelsRefresh.notify，本身很快），超时保护是死代码，容易误导后续维护者以为存在超时兜底。

**修复建议**：invalidateAfterProviderAuthChange 本身已很轻量（不再销毁实例），可以恢复为同步 await 以保住"返回即生效"语义；同时删除未使用的 _options 参数或让其真正生效。

**验证结论**：两个事实均核实属实：control.ts:26-27 通过 bridge.fork（bridge.ts:77-78 即 Effect.runFork，后台 fiber 不等待）执行失效，上游 v7.4.16 是同步 yield*；provider-auth-lifecycle.ts:42 的 _options 参数确实从未被读取，control.ts:27 传入的 { timeout: "5 seconds" } 是死代码。但严重级别被夸大：(1) 竞态窗口极小——现在的 invalidateAfterProviderAuthChange 只做 cache.clear + ModelsRefresh.notify（provider-auth-lifecycle.ts:44-48），fork 的 fiber 在微秒-毫秒级完成，而调用方拿到 HTTP 响应再发起 GET /provider 至少一个网络往返；(2) 主要调用方（VSCode 扩展）在 auth.set 之后都会显式调用 disposeGlobal 再拉取 provider 列表（provider-actions.ts:604-606 connectProvider 流程），实例重建后必然拿到新注册表，竞态被主路径掩盖。实际风险仅限直接调 SDK 的第三方脚本在极小时间窗内拿到旧列表，加上死代码的误导性，建议降为 low。


### F42【低/回归】GLM-5.2 变体逻辑下沉后顺序翻转并整段删除了共享文件中的上游分支

- **域**：upstream-touch
- **位置**：`packages/opencode/src/provider/transform.ts:689`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：对照 git show v7.4.16:packages/opencode/src/provider/transform.ts 确认上游 GLM-5.2 三个分支均为 high 在前（openrouter: {high,xhigh}；openai-compatible: {high,max}；anthropic: {high,max}），下沉到 kilocode/provider/transform.ts 后被翻转为强档位在前。已修正 glm52Variants 三个分支的键序与上游一致；Kilo 新增的 @ai-sdk/openai 分支顺序对齐同族 openai-compatible 分支，并在注释中注明升级对照要求。测试更新说明：provider-variant-order.test.ts 原测试名与断言（keeps max/xhigh first）固化的是翻转后的回归行为，属本次有意修复的行为变化，已改为 keeps high first (matches upstream) 并从 2 条扩充到 4 条（补 @ai-sdk/openai 与 @ai-sdk/anthropic 分支）。

**修改文件**：`packages/opencode/src/kilocode/provider/transform.ts`、`packages/opencode/test/kilocode/provider-variant-order.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/provider-transform.test.ts test/kilocode/provider-variant-order.test.ts → 8 pass / 0 fail；test/provider/transform.test.ts（含 glm-5.2 断言）随 test/provider/ 全目录 428 pass

**问题描述**：上游 variants() 中 GLM-5.2 的三个 npm 分支返回 { high, xhigh } / { high, max }，下沉到 kilocode/provider/transform.ts 的 glm52Variants 后变为 { xhigh, high } / { max, high }（并新增 @ai-sdk/openai 分支）。变体键序影响 UI 展示顺序与可能的默认档位选择，这是内置 openrouter/@ai-sdk/anthropic/@ai-sdk/openai-compatible 路径上的行为变化。同时共享文件中上游 glm52 代码被整体删除而非标记保留，后续上游若修改该段逻辑，合并时只能靠 kilocode/provider/transform.ts 内的注释提醒人工对照，新增的 metadataVariants 也会在模型带 reasoning_options 元数据时优先于上游全部分支生效（当前仅 Kilo gateway 目录带该字段，models.dev 若未来引入将静默改变内置 provider 行为）。

**修复建议**：确认顺序翻转是有意的默认档位设计并在 README 注明；metadataVariants 建议加 npm/来源白名单防御，避免未来 models.dev 字段扩展时静默接管内置 provider 的变体生成。


### F43【低/缺陷】resolveSDK 中 websocket transport 注册早于 version 防回写检查，过期加载会遗留未关闭的 transport

- **域**：upstream-touch
- **位置**：`packages/opencode/src/provider/provider.ts:1802`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：WebSocket transport 注册顺序修正：s.websockets.set 从「SDK 加载前」移到「加载完成且 version 防回写检查通过后」，与 s.sdk.set 同点提交；version 失配（配置热更新已 bump）的过期加载不注册并 close 释放 transport；注册前若同 key 残留旧 transport 先 close 再覆盖；加载失败路径（catch）也 close 未注册的 transport。测试覆盖说明：transport 位于 State 内部且 KiloOpenAIWebSocket.create 仅对 npm=@ai-sdk/openai + websocket:true 生效，无低风险注入点可直接断言 close 调用；version 失配分支由既有测试「配置更新前启动的异步模型加载不会回写旧缓存」驱动执行，注册分支由 F38 新增并发测试驱动，行为回归由 provider 全测试套（428 条）保障。

**修改文件**：`packages/opencode/src/provider/provider.ts`

**测试**：cd packages/opencode && bun test test/provider/ → 428 pass / 0 fail；test/kilocode/provider-config-refresh.test.ts → 19 pass / 0 fail

**问题描述**：resolveSDK 在异步加载 SDK 之前就执行 s.websockets.set(key, websocketFetch)，而 version 防回写检查只保护 s.sdk.set。配置热更新触发 ConfigRefresh 清理并 close 该 Provider 的 transport 后，先前启动、尚未完成的 resolveSDK 仍会把新建 transport 写回 websockets Map（旧 key），这个 transport 不再被增量清理扫到（key 对应旧配置 hash 但同前缀会被扫到——但写入发生在清理之后），只能等实例销毁时的 finalizer 统一 close；并发同 key 的两次 resolveSDK 也会后者覆盖前者且不 close 被覆盖的 transport。泄漏对象是 WebSocket 连接池，量级小但生命周期可能很长。

**修复建议**：把 websockets.set 移到与 s.sdk.set 相同的 version 检查之后；set 前若同 key 已存在旧 transport 先 close 再覆盖。


### F44【低/质量】loadGlobal 的 while(true) 稳定性重试无上限，且 updateGlobal 后首次读取会重复失效并双发 ConfigUpdated 事件

- **域**：upstream-touch
- **位置**：`packages/opencode/src/config/config.ts:403`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：三处修复：(1) loadGlobal 稳定性重试加上限 5 次，超限采用最后一次快照并 logWarning（globalStamp 记录该快照状态，文件继续变化仍会被 refreshGlobal 检测并重新加载，不丢更新）；(2) 双发 ConfigUpdated 修复：updateGlobal changed 分支在 reset() 后把 globalStamp 推进到写盘后的实际文件 stamp，紧随其后的首次读取不再把自己的写入误判为「外部修改」而重复 invalidateAll 并再发一次事件——缓存已由 reset() 失效，下次读取必然重新加载最新内容，推进 stamp 不会隐藏并发外部修改；(3) loadSnapshot 改名行补 kilocode_change 内联标记（注明上游此函数名为 loadGlobal）。测试：新增「updateGlobal 后首次读取不再重复发出 ConfigUpdated」锁定单事件语义。重试上限的「外部进程持续改写」场景无法在测试中稳定复现，未单独覆盖，正常收敛路径由既有 config 测试回归。

**修改文件**：`packages/opencode/src/config/config.ts`、`packages/opencode/test/kilocode/global-config-refresh.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/global-config-refresh.test.ts → 5 pass；config-resilience、project-config-update、instance-reload、server/config-overlay 回归通过；cd packages/core && bun test test/config/config.test.ts → 15 pass / 0 fail

**问题描述**：loadGlobal 循环重读直到前后 stamp 一致，正常场景（种子写入、legacy TOML 迁移）两轮内收敛，但没有次数上限或退避，外部进程持续改写配置文件时会以"6 文件全文读取 + 解析 + 可能写盘"为单位自旋。另外 updateGlobal 写盘后 reset() 只失效缓存、globalStamp 要等下一次 loadGlobal 完成才推进，因此紧随其后的第一次 get()/getGlobal() 的 reload() 会把自己刚写的变更再次判定为"外部修改"，额外做一轮 invalidateAll 并再 emit 一次 ConfigUpdated——每次保存客户端会收到两个事件、触发两轮刷新。

**修复建议**：给 loadGlobal 加重试上限（超限后接受最后一次快照并告警）；updateGlobal 成功后同步推进 globalStamp（或在 reset() 内标记跳过下一次 stamp 差异），消除重复失效与重复事件。


### F45【低/质量】evaluate 仍用 Date.now() 判定 entry.cached 过期，与 get/commit 改用的 Clock 不一致

- **域**：upstream-touch
- **位置**：`packages/opencode/src/provider/model-cache.ts:254`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：evaluate 中 entry.cached 的过期判定与写入（expires 计算）两处 Date.now() 统一替换为 yield* Clock.currentTimeMillis，与 get/commit 的时间源一致，消除 TestClock 下 view.timestamp 与 entry.cached 两套过期判定互相矛盾的可能。测试覆盖：F08 新增的「空缓存过期后前台请求同步重取」测试同时锁定本行为——TestClock 推进 6 分钟后同步 evaluate 路径要求 entry.cached 按测试时钟判定过期并重新拉取，若仍用 Date.now()（真实时钟未动）会 commit 旧空值导致该测试失败。

**修改文件**：`packages/opencode/src/provider/model-cache.ts`、`packages/opencode/test/kilocode/model-cache-effect.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/model-cache-effect.test.ts → 16 pass / 0 fail（全部 TestClock 测试通过）

**问题描述**：本次改动把 get() 和 commit() 的时间源改为 effect 的 Clock（以支持 TestClock），但 evaluate 中 entry.cached 的 expires 判定和写入仍使用 Date.now()。TestClock 推进 6 分钟后 view.timestamp 判定为过期，而 entry.cached 按真实时钟仍然新鲜，两套判定可能矛盾；现有测试恰好通过 reload→invalidate 清掉 cached 绕开了该路径，一旦测试或调用顺序变化就会出现"过期但 commit 回旧值"的令人困惑行为。生产环境两个时钟一致，无实际影响。

**修复建议**：evaluate 中的 Date.now() 统一替换为 Clock.currentTimeMillis，保持单一时间源。


### F46【低/质量】ProviderState 的 optimistic/optimisticAuth 字段无任何消费方，且 applyAuth set 分支不清除同 ID 的 optimisticAuth

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/src/context/provider.tsx:82`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：确认 optimistic/optimisticAuth 确无任何消费方后删除：全仓库 grep 显示 provider.tsx 之外仅 provider-context.test.ts（测试）引用这两个字段，ProviderContextValue 从未暴露它们，渲染与逻辑路径零读取。删除内容：ProviderState 接口两个字段、initialProviderState 两项初始化、applyProviderMessage 三个分支的维护代码；applyAuth 从返回 { states, optimistic } 对简化为直接返回认证状态映射（三态 preserve/set/clear 语义不变），审核指出的『set 分支不清除同 ID optimisticAuth』的不一致随字段删除一并消失；reconcile 的 doc 注释同步去掉『乐观覆盖』表述。测试断言更新说明：provider-context.test.ts 原第 53/105 行对 added.optimistic / auth.optimisticAuth 为空对象的断言，因字段已删除改为断言字段为 undefined（死状态字段不回潮守卫）——属于行为有意变化后的断言更新，未削弱其余任何断言。webview-ui 局部 bunx tsc --noEmit 通过，确认无残留引用。

**修改文件**：`packages/kilo-vscode/webview-ui/src/context/provider.tsx`、`packages/kilo-vscode/tests/unit/provider-context.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/provider-context.test.ts（含于 5 文件批跑）→ 82 pass / 0 fail

**问题描述**：optimistic 与 optimisticAuth 在 initialProviderState/applyProviderMessage/applyAuth 中被维护（拷贝、清空、删除），但 ProviderContextValue 未暴露它们，整个渲染与逻辑路径没有任何读取方；同时 applyAuth 的 set 分支（第 114-117 行）更新 states 却保留同 ID 的 optimisticAuth 不清除，与 clear 分支语义不一致。死状态字段使本已复杂的合并函数进一步膨胀，容易误导后续维护者以为存在乐观 UI 机制。

**修复建议**：删除 optimistic/optimisticAuth 字段及相关维护代码；若确有乐观覆盖的规划，先补上消费方并统一 set/clear 分支的清理语义。


### F47【低/质量】validModel 的"providers 为空即有效"豁免逻辑存在三份重复实现

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/agent-manager/NewWorktreeDialog.tsx:126`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：在 provider-utils.ts 新增导出函数 isModelUsable(providers, connected, selection)（类型守卫签名 selection is ModelSelection，带详细中文注释说明豁免语义），统一收敛"providers 为空即有效"的重复实现。替换点共四处：审核列出的三处——session.tsx validModel、NewWorktreeDialog.tsx validModel、session-model-store.ts valid——以及同语义的第四处 model-selection.ts 私有 validate（返回值形式 selection|null，改为委托 isModelUsable，行为完全一致）。所有文件均在 packages/kilo-vscode 内（fork 主战场），无需 kilocode_change 标记。审核建议中"让 session.tsx 复用 session-model-store.ts 纯函数消除平行实现"属更大范围重构，超出本条最小入侵边界，未实施（session.tsx 与 session-model-store 的解析函数仍平行存在，但豁免语义已单点收敛，漂移风险的核心已消除）。provider-utils.test.ts 新增 isModelUsable 完整用例：空 selection、providers 未加载豁免、就绪后委托 isModelValid（连接判定、kilo 免费/付费、未知模型）、过渡快照下 provider 缺失不豁免。

**修改文件**：`packages/kilo-vscode/webview-ui/src/context/provider-utils.ts`、`packages/kilo-vscode/webview-ui/src/context/model-selection.ts`、`packages/kilo-vscode/webview-ui/src/context/session-model-store.ts`、`packages/kilo-vscode/webview-ui/src/context/session.tsx`、`packages/kilo-vscode/webview-ui/agent-manager/NewWorktreeDialog.tsx`、`packages/kilo-vscode/tests/unit/provider-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/provider-utils.test.ts tests/unit/model-selection.test.ts tests/unit/session-model-store.test.ts tests/unit/session-preferences.test.ts tests/unit/stale-model-retention.test.ts → 63 pass / 0 fail（含 isModelUsable 新增用例）；new-worktree-dialog-sandbox.test.ts 等 13 个关联文件 260 pass / 0 fail

**问题描述**：NewWorktreeDialog.tsx 第 126-129 行、session.tsx 第 602-604 行（validModel）、session-model-store.ts 第 47-51 行（valid）实现了完全相同的判断：providers 未加载时视为有效，否则走 isModelValid。且 session-model-store.ts 的 getSessionModel/getSelected 仅被测试引用，与 session.tsx 内的真实实现平行存在（上游既有结构，本次在两处同步加了校验，加剧未来漂移风险）。三处任何一处的语义调整（例如豁免条件变化）都需要人工同步。

**修复建议**：把该判断抽为 provider-utils.ts 的导出函数（如 isModelUsable(providers, connected, selection)）或直接挂到 ProviderContextValue，三处统一调用；同时考虑让 session.tsx 复用 session-model-store.ts 的纯函数，消除平行实现。


### F48【低/架构】context 层的 provider-utils.ts 反向依赖 components/shared/model-selector-utils 的 isSmall

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/src/context/provider-utils.ts:2`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：将 isSmall 与 KILO_AUTO_SMALL_IDS 下沉到 packages/kilo-vscode/src/shared/provider-model.ts（两侧均已依赖的共享层），isSmall 参数类型改用结构化 { providerID: string; id: string }（与原 Pick<EnrichedModel, ...> 结构等价），使共享层不引用 webview 类型。provider-utils.ts 改为从共享层导入 isSmall，消除 context → components 的反向层次依赖；model-selector-utils.ts 改为从共享层导入并 re-export isSmall / KILO_AUTO_SMALL_IDS（两者均为上游导出符号，依维护原则第 5 条保持导入路径与符号完全兼容，全仓库无其他直接消费方受影响）。新增测试：model-selector-utils.test.ts 增加 isSmall describe（经 re-export 路径验证行为不变与 ID 集合同步）；provider-utils.test.ts 既有的 isVisibleModel small 隐藏用例继续覆盖新导入路径。

**修改文件**：`packages/kilo-vscode/src/shared/provider-model.ts`、`packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts`、`packages/kilo-vscode/webview-ui/src/context/provider-utils.ts`、`packages/kilo-vscode/tests/unit/model-selector-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/model-selector-utils.test.ts tests/unit/provider-utils.test.ts（含于 5 文件批跑）→ 82 pass / 0 fail；webview-ui bunx tsc --noEmit 通过

**问题描述**：isVisibleModel 依赖从 components/shared/model-selector-utils 导入的 isSmall，形成 context → components 的反向层次依赖（model-selector-utils 又 type-import context/provider 的 EnrichedModel，仅靠类型擦除避免运行时循环）。isSmall 的实现只依赖 src/shared/provider-model 的 KILO_PROVIDER_ID 和固定 ID 集合，没有理由留在组件层。

**修复建议**：将 isSmall 与 KILO_AUTO_SMALL_IDS 下沉到 packages/kilo-vscode/src/shared/provider-model.ts（两侧均已依赖该模块），model-selector-utils 与 provider-utils 从共享层导入，保持依赖单向。


### F49【低/质量】核心状态合并逻辑的测试以内嵌字符串脚本和源码字符串断言实现，脆弱且无类型检查

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/tests/unit/provider-context.test.ts:9`
- **验证**：未单独验证（低级别）
- **处理状态**：**接受现状**

**处理记录**：按批次指示接受现状。provider-context.test.ts 的字符串脚本测试重构需要先把 applyProviderMessage/initialProviderState/createProviderRetry/mergeProviderCatalog 等纯逻辑从含 JSX 的 provider.tsx 抽出到独立的 provider-state.ts 模块，属于状态机抽模块的结构性重构，会扩大本轮补丁面且与 F12 刚确立的『最小补丁』原则方向冲突，本轮不做。现有字符串脚本测试仍在正常运行并通过（本轮 F46 的字段删除也已同步更新其断言），功能守护未受影响。

**测试**：cd packages/kilo-vscode && bun test tests/unit/provider-context.test.ts → 通过（维持现状）

**问题描述**：applyProviderMessage/createProviderRetry 等核心纯函数的测试通过 Bun.spawnSync 执行内嵌 script 字符串（约 150 行无类型检查代码，失败靠 console.error + process.exit(1)，无法逐条断言定位）；同文件第二个用例及 provider-connection-refresh-source.test.ts 整体采用读源码字符串 contains 的方式断言（如检查 session.tsx 包含特定表达式、KiloProvider.ts 特定调用出现在偏移 1200/300 字符窗口内），对无害的格式化或重构极其脆弱，且不能证明运行时行为。

**修复建议**：把 applyProviderMessage/initialProviderState/createProviderRetry/mergeProviderCatalog 等纯逻辑从 provider.tsx 抽到无 JSX 的 provider-state.ts，测试直接 import 并用常规 expect 断言；source-grep 类测试改为行为测试或移除。


### F50【低/入侵性】删除上游 Popular providers 区块属于对上游 UI 功能的整段移除

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/ProvidersTab.tsx:51`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：与 F27 为同一问题，合并处理，状态相同。README 已补记该决策与动机，文档与实现一致；代码侧未采用条件渲染方案（该删除自 fork 初始化即存在、已平安经历一次上游合并、有源码测试锁定，改回条件渲染反而扩大本轮 diff），孤儿 i18n key 保留不清理以缩小对 30+ 语言文件的入侵面。

**修改文件**：`README.md`

**测试**：同 F27

**问题描述**：ProvidersTab 移除了上游的 popularProviders memo 与整个热门 provider 快捷连接列表（约 70 行），并将区块标题替换为自定义 provider 入口。虽然 ProviderSelectDialog 经 catalogProviders 仍提供完整的 provider 连接目录（功能可达），但整段删除上游 UI 代码与 README "保持 ZLF 补丁最小化"和"需要改变行为时保留兼容壳"的原则不完全一致，会在上游后续修改该区块时产生合并冲突。

**修复建议**：如果只是不想展示热门列表，优先用条件渲染或常量开关隐藏（保留上游代码结构并标 kilocode_change），而非物理删除代码块。


### F51【低/回归】default_agent 配置为 orchestrator 的存量用户默认智能体静默变为字母序第一个可见 agent

- **域**：agents-i18n
- **位置**：`packages/kilo-vscode/src/kilo-provider-utils.ts:227`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：修改 packages/kilo-vscode/src/kilo-provider-utils.ts 的 filterVisibleAgents：利用「后端 Agent.list() 把 config.default_agent 排在首位」的排序契约，当 agents[0]（后端认定的默认智能体）未被过滤时沿用原行为（visible[0] 即它）；当它被隐藏/过滤（如 default_agent=orchestrator）时优先回退到 visible 中 name 为 code 的 agent，找不到 code 再按原逻辑取 visible[0]（字母序第一个）。附中文注释说明与后端 defaultInfo() 回退语义对齐的动机。新增 3 个测试：默认被隐藏时回退 code、被隐藏且无 code 时回退首个可见、默认可见时即使后面有 code 也不抢占；既有 8 个 filterVisibleAgents 测试全部保持通过。AgentBehaviourTab 的提示/一键重置属建议性增强，未实施以保持最小入侵。

**修改文件**：`packages/kilo-vscode/src/kilo-provider-utils.ts`、`packages/kilo-vscode/tests/unit/kilo-provider-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/kilo-provider-utils.test.ts → 85 pass / 0 fail

**问题描述**：后端 Agent.list() 排序会把 config.default_agent 匹配的 agent 排在首位（packages/opencode/src/agent/agent.ts 的 sortBy 逻辑），且未配置时优先 code。当用户 config 中 default_agent 为 "orchestrator" 时，orchestrator 排第一但被 filterVisibleAgents 过滤掉，visible[0] 变为按 name 升序的第一个 primary agent（通常是 ask），webview 的 setDefaultAgent 与新会话 pendingAgentSelection 都会使用它；而后端 defaultInfo() 仍接受 orchestrator（未 hidden、primary），造成扩展 UI 与后端默认值不一致。同时 AgentBehaviourTab.tsx 第 300 行的默认智能体 Select 用 defaultAgentOptions().find 匹配 current，orchestrator 已不在选项中，current 为 undefined，用户看不到自己当前配置的默认值。影响面仅限显式配置了 default_agent=orchestrator 的存量用户（该 agent 上游已标记 deprecated），故为低严重度。

**修复建议**：filterVisibleAgents 回退时优先在 visible 中查找 name 为 "code" 的 agent 再取 visible[0]；AgentBehaviourTab 可在 config.default_agent 指向被隐藏 agent 时显示提示或提供一键重置为默认。


### F52【低/架构】"保留同名自定义 orchestrator" 的 native === false 分支在真实后端数据流中不可达，用户对 orchestrator 的自定义配置会静默失效

- **域**：agents-i18n
- **位置**：`packages/kilo-vscode/webview-ui/src/utils/agent-display.ts:17`
- **验证**：未单独验证（低级别）
- **处理状态**：**保守处理**

**处理记录**：评估结论：让用户自定义 orchestrator 正常显示需要修改后端同名合并语义（packages/opencode/src/agent/agent.ts 或 kilocode/agent/index.ts 的 patchAgents），会触碰 README 明确声明未修改的核心文件、影响所有下游对 native 字段的消费，且与「隐藏 orchestrator 即设计意图」相冲突，不属于低风险修复，故保留防御分支并补充说明。已做：1) agent-display.ts 的 isHiddenAgent 加详细中文 JSDoc，说明 native === false 分支在当前数据流不可达的机制（内置 orchestrator 由 patchAgents 以 native: true 预注入，用户 config.agent / agent/*.md 同名定义必与之合并、native 恒为 true）、用户自定义配置会随隐藏一起不可见、该分支仅为上游合并语义变化时的向前兼容防御；2) shared/agents.ts 的 HIDDEN_AGENT_NAMES 加注释交叉引用；3) 两个相关测试（agent-display.test.ts 'keeps custom orchestrator agents visible'、kilo-provider-utils.test.ts 'keeps custom orchestrator agents'）加注释标明是防御分支的行为锁定而非真实数据流，防止维护者误解。AgentBehaviourTab 的用户提示为可选增强，未实施。

**修改文件**：`packages/kilo-vscode/webview-ui/src/utils/agent-display.ts`、`packages/kilo-vscode/src/shared/agents.ts`、`packages/kilo-vscode/tests/unit/agent-display.test.ts`、`packages/kilo-vscode/tests/unit/kilo-provider-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/agent-display.test.ts tests/unit/kilo-provider-utils.test.ts → 92 pass / 0 fail

**问题描述**：isHiddenAgent 和 host 端 filterAgents 都设计了 native === false 时保留同名 agent 的保护分支，测试（agent-display.test.ts "keeps custom orchestrator agents visible"、kilo-provider-utils.test.ts "keeps custom orchestrator agents"）也验证了该分支。但后端合并逻辑（packages/opencode/src/agent/agent.ts 第 354-361 行）只有当 agents[key] 不存在时才创建 native: false 的新 agent；内置 orchestrator 由 KiloAgent.patchAgents 以 native: true 预先注入（packages/opencode/src/kilocode/agent/index.ts 第 496 行），用户通过 config.agent 或 agent/*.md（markdown agent 同样并入 config.agent）定义的同名 orchestrator 一定与内置合并、native 恒为 true。因此用户为 orchestrator 自定义的 model/prompt 等配置在 ZLF 扩展中会随隐藏一起静默失效，没有任何提示；防御分支只是理论防御，实际不会放行任何 "自定义 orchestrator"。这不是功能缺陷（隐藏 orchestrator 正是设计意图，且防御方向正确），但测试与 README 表述容易让维护者误以为用户可以通过自定义同名 agent 绕开隐藏。

**修复建议**：在 agent-display.ts 或 shared/agents.ts 加注释说明后端同名合并语义（native 恒为 true，防御分支仅为向前兼容）；可考虑在 AgentBehaviourTab 对 config 中存在 orchestrator 配置的情况给出"该内置智能体已在本扩展中隐藏"的提示。


### F53【低/质量】session.messages.welcome 品牌文案跨语言不一致：zh 已改为 ZLF Code，en 与 zht 仍为 Kilo Code

- **域**：agents-i18n
- **位置**：`packages/kilo-vscode/webview-ui/src/i18n/zht.ts:1252`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：将 en.ts（第 1279-1280 行）与 zht.ts（第 1252 行）的 session.messages.welcome 品牌从 Kilo Code 改为 ZLF Code，与 zh.ts 一致；其余文字（AI coding assistant 描述）保持不变。检查确认 i18n-keys.test.ts 原本只校验键存在性、不校验文案内容，故在其中新增「品牌一致性」describe：断言 en/zh/zht 三份主要维护语言的 session.messages.welcome 均包含 ZLF Code 且不含 Kilo Code。消费点 WelcomeEmptyState.tsx 经 t() 取键，无硬编码旧文案。其他语言（ko/de/fr 等）的 welcome 未改，与批次指示一致；workStyle.onboarding.welcome（欢迎使用 Kilo）不在本条范围。

**修改文件**：`packages/kilo-vscode/webview-ui/src/i18n/en.ts`、`packages/kilo-vscode/webview-ui/src/i18n/zht.ts`、`packages/kilo-vscode/tests/unit/i18n-keys.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/i18n-keys.test.ts → 9 pass / 0 fail（含新增品牌一致性断言）；五个相关测试文件合跑 108 pass / 0 fail

**问题描述**：zh.ts 第 1291 行将欢迎语改为 "ZLF Code 是一个 AI 编程助手…"，但 zht.ts 第 1252 行仍是 "Kilo Code 是一個 AI 程式設計助手…"，en.ts 第 1279-1280 行也仍是 Kilo Code。繁体与英文界面用户在聊天窗口首屏看到的品牌与扩展显示名（ZLF Code）不一致，也与 README "ZLF 身份维护" 中降低品牌混淆的目标相悖。

**修复建议**：将 en.ts 与 zht.ts 的 session.messages.welcome 同步改为 ZLF Code，保持三份主要维护语言的品牌一致。


### F54【低/质量】README 描述与实现不符：fetchAndSendAgents 的 allAgents 未经过 filterAgents，orchestrator 仍下发到 webview

- **域**：agents-i18n
- **位置**：`README.md:167`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：fetchAndSendAgents 下发 agentsLoaded 前对 allAgents 应用 filterAgents，与 README 描述一致，把 orchestrator 过滤收敛到下发单点；filterVisibleAgents 仍接收后端原始列表（其 defaultAgent 回退语义依赖 agents[0] 可能是被隐藏的 orchestrator，加注释说明）。已逐一核查 webview 全部 allAgents 消费点确认过滤后无破坏：AgentBehaviourTab 92/96 行 isHiddenAgent 防御成为冗余但行为不变（config-only orchestrator 仍走字符串分支隐藏）、202 行 removableModes 只取 native===false（filterAgents 保留）、371 行与 ModeEditView 36 行的 name 均来自已过滤的 agentNames、session.tsx 793 行为接收端。filterAgents 保留 native===false 同名自定义 agent 的语义不变。新增 4 个测试锁定：双列表过滤、自定义同名保留、allAgents 保留 subagent/hidden（仅 filterAgents 不做可见性过滤）、defaultAgent 回退到 code。

**修改文件**：`packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/tests/unit/kilo-provider-agents-loaded.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/kilo-provider-agents-loaded.test.ts tests/unit/agent-display.test.ts：均通过。全量回归：bun test tests/unit/ 共 3536 个测试，3535 pass、1 fail（worktree-manager.test.ts 的 resolveStartPoint 用例，经 git stash 在 main 基线验证为既有失败，与本批次无关）

**问题描述**：README 第 167 行表格写 "KiloProvider.fetchAndSendAgents()：后端返回 agents 后先调用 filterAgents，再生成 agentsLoaded"，但实际实现（packages/kilo-vscode/src/KiloProvider.ts 第 2597-2605 行）是 const all = agents 后仅 visible 经 filterVisibleAgents（内部含 filterAgents）过滤，allAgents: all.map(mapAgent) 未过滤，native orchestrator 仍随消息下发到 webview 的 session.allAgents()。当前隐藏依赖各消费入口自行防御：AgentBehaviourTab.tsx 第 92、96 行调用了 isHiddenAgent，但 ModeEditView.tsx 第 36 行直接 allAgents().find 无防御（入口受控暂无实际泄漏）。这属于文档与实现不一致，且防御分散在各 UI 入口，未来新增直接消费 allAgents 的界面容易遗漏过滤重新暴露 orchestrator。

**修复建议**：二选一：修正 README 表述为"visible 经 filterVisibleAgents 过滤，allAgents 保留完整列表、由 webview 各入口用 isHiddenAgent 过滤"；或在 session context 的 allAgents accessor 处集中过滤内置 orchestrator，把防御收敛到单点（需确认 AgentBehaviourTab 通过字符串分支 isHiddenAgent(name) 仍能正确隐藏 config-only 的 orchestrator，当前逻辑已支持）。


### F55【低/回归】parseFileAttachments 不再传 workspaceDir，workspace 内的绝对路径 mention 被无条件丢弃

- **域**：misc-infra
- **位置**：`packages/kilo-vscode/webview-ui/src/hooks/file-mention-utils.ts:333`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：采用审核建议的「等效逻辑」而非传 workspaceDir（webview 的 workspaceDir 是窗口工作区根，worktree/远程会话目录与之不同，传它会破坏 3b4fae7425 的会话目录解析设计）：buildFileAttachments 无 dir 分支不再无条件丢弃绝对路径，改为与相对路径一样以 path 原样传给扩展端（相对路径的 ../ 逃逸检查保留）；resolveMessageFile 对 path 形式附件（相对或绝对）相对会话目录解析后做归属校验（path.relative 判定），越界返回 undefined 丢弃——workspace 内绝对路径恢复自动附加，目录外文件仍不可自动附加（保持权限系统安全边界），url 形式（file://、data:、session:）不受影响；4 处调用点（KiloProvider.ts 两处、cloud-session.ts 两处）过滤丢弃结果。更新 1 个既有断言（行为有意变化：无 dir 绝对路径从丢弃改为 path 转发），新增 8 个测试覆盖会话目录内/外绝对路径、../ 逃逸、url 形式豁免与端到端 parseFileAttachments。

**修改文件**：`packages/kilo-vscode/webview-ui/src/hooks/file-mention-utils.ts`、`packages/kilo-vscode/src/kilo-provider/message-files.ts`、`packages/kilo-vscode/src/KiloProvider.ts`、`packages/kilo-vscode/src/kilo-provider/handlers/cloud-session.ts`、`packages/kilo-vscode/tests/unit/message-files.test.ts`、`packages/kilo-vscode/tests/unit/file-mention-utils.test.ts`、`packages/kilo-vscode/tests/unit/use-file-mention.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/message-files.test.ts tests/unit/file-mention-utils.test.ts tests/unit/use-file-mention.test.ts tests/unit/cloud-session-handler.test.ts tests/unit/prompt-send-contract.test.ts —— 通过；bun run typecheck（kilo-vscode 包级）通过

**问题描述**：useFileMention.ts 行 375 调用 buildFileAttachments 时不再传 workspaceDir，函数始终走无 dir 分支：绝对路径 mention 一律 continue 丢弃（行 333）。上游行为是绝对路径若解析后位于 workspace 内则生成 file:// URL 附件发送。当前 file search 结果与拖放（convertToMentionPath）通常产出相对路径，实际触发面小，但任何以绝对路径进入 mentionedPaths 的 workspace 内文件（如拖放在特殊 cwd 下未转成功相对路径时）会静默不作为附件发送，用户无感知。

**修复建议**：无 dir 分支中对绝对路径不直接丢弃，可将其作为 path 原样传给扩展端，由 resolveMessageFile 结合会话目录做归属校验后再决定取舍。


### F56【低/缺陷】Zed 扩展 archive URL 被 sync-versions 同步为 Kilo-Org 不存在的 v7.4.1603 release，下载地址全部失效

- **域**：misc-infra
- **位置**：`packages/extensions/zed/extension.toml:19`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：packages/extensions/zed/extension.toml 已用 git checkout v7.4.16 完整恢复为上游原值（version 7.4.16 与五个 Kilo-Org archive URL，零 diff）；sync-versions.ts 删除对该文件的改写逻辑并在文件头注释说明排除原因（URL 指向上游 release，写入 ZLF 市场版本会 404），防止下次发布再写坏；check-release.ts 的 parse 新增 base 字段（上游底座版本 A.B.C），extension.toml 校验从市场版本改为校验保持底座版本，防止被误写后通过发布校验。幂等运行 sync-versions.ts 7.4.1603 确认 0 文件更新且不再触碰 zed；真实仓库运行 check-release.ts zlfcode-v7.4.16-v0.03 校验通过。

**修改文件**：`packages/extensions/zed/extension.toml`、`script/sync-versions.ts`、`script/zlfcode/check-release.ts`、`script/zlfcode/check-release.test.ts`

**测试**：cd script && bun test zlfcode/check-release.test.ts —— 4 pass（含新增「Zed 扩展被误写成市场版本时校验失败」用例）；bun run script/zlfcode/check-release.ts zlfcode-v7.4.16-v0.03 通过

**问题描述**：script/sync-versions.ts 把 extension.toml 的 version 和所有 archive URL 中的版本统一替换为 ZLF 市场版本 7.4.1603，但 URL 仍指向 https://github.com/Kilo-Org/kilocode/releases/download/v7.4.1603/...，上游不存在该 tag 的 release，全部 404。注释「同步 Kilo 发布产物地址」与实际不符。check-release.ts 只校验 version 行，不校验 URL 有效性。ZLF 不发布 Zed 扩展时影响面为零，但该配置处于损坏状态。

**修复建议**：sync-versions.ts 对 zed extension.toml 的 URL 保持上游底座版本（如 v7.4.16）不做批次替换，或在 ZLF 分支中明确废弃该扩展目录并在 README 说明。


### F57【低/质量】workflow_dispatch 留空 version 时 label 取市场版本，check-release.ts 的 tag pattern 校验必然失败

- **域**：misc-infra
- **位置**：`.github/workflows/publish-zlfcode.yml:52`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：publish-zlfcode.yml 解析版本号 step：workflow_dispatch 留空 version 且非 tag 触发时，label 不再取 package.json 的市场版本（7.4.1603，与 check-release.ts 的 ^zlfcode-v(\d+)\.(\d+)\.(\d+)-v0\.(\d{2})$ 必然不匹配），改为从 README.md 的「发布批次」表格行推导（推导失败明确报错退出）；原「label 为空则用市场版本」的死代码兜底改为显式报错；input 描述同步修正为「留空则使用 README 中的当前发布批次」。本地模拟留空场景端到端验证：README 推导得 label=7.4.16-v0.03，check-release.ts 校验通过。

**修改文件**：`.github/workflows/publish-zlfcode.yml`

**测试**：bun run script/check-workflows.ts —— ok (29 workflows)；本地以相同 bun -e 命令模拟留空 fallback，label 推导与 check-release.ts 校验均通过

**问题描述**：输入描述写「留空则使用市场版本」，但留空且非 tag 触发时 label 会取 package.json 的 7.4.1603，随后执行 check-release.ts "zlfcode-v7.4.1603"，与 pattern ^zlfcode-v(\d+)\.(\d+)\.(\d+)-v0\.(\d{2})$ 不匹配直接抛错，prepare job 必然失败。手动触发路径与描述承诺的行为矛盾。

**修复建议**：要么将留空场景改为从 README 或最近 zlfcode-v* tag 推导发布批次，要么把 version 输入标记为 required 并修正描述。


### F58【低/质量】STARTUP_TIMEOUT_SECONDS 从 30 秒放宽到 180 秒，本地启动坏死时错误反馈延迟 3 分钟

- **域**：misc-infra
- **位置**：`packages/kilo-vscode/src/services/cli-backend/server-manager.ts:19`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：启动超时按环境分级：新增导出纯函数 resolveStartupTimeoutSeconds(remoteName)，本地窗口（vscode.env.remoteName 为 undefined）用 45 秒，远程窗口（Remote SSH / WSL / Dev Container，remoteName 非空）保留 180 秒；startServer 的超时定时器/日志/错误消息与 withStartupLock 的等待上限统一使用该函数，注释详细说明分级取舍。新增 2 个测试锁定本地/远程取值。

**修改文件**：`packages/kilo-vscode/src/services/cli-backend/server-manager.ts`、`packages/kilo-vscode/tests/unit/server-manager-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/server-manager-utils.test.ts —— 通过

**问题描述**：为远程 SSH 慢启动场景把启动超时统一提高 6 倍，本地环境下 CLI 二进制损坏、端口占用等启动挂死问题也要等 3 分钟才能给出 ServerStartupError，期间 UI 停留在 connecting；withStartupLock 的等待上限也随之升到约 270 秒。未区分本地/远程场景。

**修复建议**：按 vscode.env.remoteName 区分本地（保留 30-60 秒）与远程（180 秒）超时，或在等待期间将 stderr 进度透出给用户。


### F59【低/入侵性】对上游共享文件仅删除两处空行，属无功能意义的 diff 扩散

- **域**：misc-infra
- **位置**：`packages/tui/src/kilocode/session-mentions.ts:15`
- **验证**：未单独验证（低级别）
- **处理状态**：**已修复**

**处理记录**：packages/tui/src/kilocode/session-mentions.ts 已用 git checkout v7.4.16 恢复两处被删除的空行，git diff v7.4.16 -- 该文件确认工作区与上游逐字一致（零 diff）。附加项一并完成：为 packages/kilo-gateway/src/api/profile.ts 的 5 秒超时补丁（import、fetchDefaultModel 新增 AbortSignal 参数、超时信号构造、fetch signal）与 constants.ts 的 DEFAULT_MODEL_FETCH_TIMEOUT_MS 常量补充 kilocode_change start/end 标记及中文说明。纯注释/空行恢复无行为变化，不需要新增测试。

**修改文件**：`packages/tui/src/kilocode/session-mentions.ts`、`packages/kilo-gateway/src/api/profile.ts`、`packages/kilo-gateway/src/api/constants.ts`

**测试**：git diff v7.4.16 -- packages/tui/src/kilocode/session-mentions.ts 输出为空（与上游一致）；kilo-vscode 包级 typecheck 通过

**问题描述**：该文件相对 v7.4.16 的全部改动是删除 export type 与函数间、文件末尾的两个空行，无任何行为变化，也未加 kilocode_change 标记，违反最小入侵原则并会在后续上游合并时制造无谓冲突。类似地 packages/kilo-gateway/src/api/profile.ts 的超时补丁（本身合理）也未加标记。

**修复建议**：恢复 session-mentions.ts 的空行使其与上游逐字一致；为 kilo-gateway 的小补丁补充 kilocode_change 标记。



---

# 各功能域总体评价

## ext-host

**总体评价**：本域改动整体质量较高。并发核心设计经得起推敲：providerRevision 在单一扩展宿主进程内由 KiloConnectionService 同步递增并同步广播，publish 前的 updateStoredProvider 与 revision 提升之间没有 await 间隙，保证共享密钥缓存与 revision 原子一致；fetchAndSendProviders 用 generation + revision + client 三重 stale 检查，配合 AbortController 取消与 Set 去重排队，慢速全量拉取不会用旧快照覆盖精确变更，webview 端再以 revision 单调性兜底。API key/env 复用缓存的匹配条件（providerID + 协议 + 规范化 baseURL）是 fail-closed 的，且显式排除内置 openai/anthropic/google/kilo ID，相比上游只按 baseURL 匹配更收紧，未发现密钥可被重定向到其他主机的路径。保存不阻塞等待 catalog 刷新的设计依赖后端 SSE global.config.updated 事件触发权威重拉来闭环，一致性成立的前提是后端 /config/providers 具备 read-your-writes（该保证在 provider registry 域实现）。最小入侵方面：改动集中在 packages/kilo-vscode 边界内，上游导出符号未删除（validateFavorites 保留兼容壳、fetchProviderData/resolveStoredKey 以可选参数向后兼容），extension.ts 仅改图标，符合 README 维护原则。测试覆盖充分（reset 回滚、删除哨兵、串行拉取、stale 丢弃、storedKey 协议匹配、默认收藏 seed 均有用例）。发现的实质问题集中在：auth 阶段失败无 config 回滚的部分写入状态、connected 模式无条件信任 config 兜底、extension-info 回退 ID 遗漏当前扩展 ID、首连双份全量拉取等，无 high 级缺陷。

**架构评价**：架构合理。将"精确增量消息（providerConnected/providerDisconnected + revision）+ SSE 触发的权威全量快照（providersLoaded + revision）"组合成最终一致模型是正确的取舍：保存路径只等 config PATCH，UI 即时反馈由表单数据构造的 public provider，慢速刷新由 revision 拒绝迟到快照，跨 Webview 通过 connectionService 单点广播避免了每实例各自维护版本号的漂移问题。删除哨兵采用 providerReset 两阶段写（先 null 清空变体/limit/cost 再写全量）解决了深合并无法表达"重排序/删除"的问题，失败时回滚 existing 的补偿逻辑正确。connected/catalog 双模式拆分 payload 并裁剪无关 catalog 模型，解决了 Remote-SSH 大 payload 问题，思路清晰。可改进之处：(1) config 更新与 auth.set 不在同一事务，建议 auth 失败时也回滚 provider 配置（或先 auth 后 config），使保存具备"全有或全无"语义；(2) providersRefresh 的任务结束与 finally 清理之间存在微任务窗口，handleProvidersChange 在该窗口排队的 fetch 无人消费，建议在排队后若 providersRefresh 已完成则主动补一次 fetch，或把队列消费移到 finally 中检查；(3) mergeConfiguredProviders 把 config 中的自定义 provider 无条件视为 connected，建议附带后端实际缺失的标记以便 UI 区分"临时空窗"与"持久加载失败"；(4) refreshConnectionData 在 initializeConnection 尾部与 SSE connected 回调各调用一次，首连会双份拉取 9 个接口，可用一次性标记或 generation 去重。整体上没有必要推翻现有实现的更优方案。

## shared-helpers

**总体评价**：本域改动整体质量较高，符合 README 维护原则。协议推断与模型发现集中在 packages/kilo-vscode/src/shared/ 边界内：provider-model.ts 用单一 CUSTOM_PROVIDER_META 表完成四类 npm 包到三种协议的映射与 baseURL 尾缀规范化；fetch-models.ts 按 protocol 分发 OpenAI/Anthropic/Gemini 三种发现实现，认证头（Bearer / x-api-key + anthropic-version / x-goog-api-key）与 endpoint 拼接正确；新增 fetch-models-timeout.ts 让 webview 超时（16s）晚于 host 超时（15s），保证 host 侧错误先到达。最小入侵方面：上游导出符号 fetchOpenAIModels 保留且签名兼容（OpenAIOptions 等价于原 Options），withCustomProviderDeletions 保留函数名、仅放宽返回类型为 ProviderPatch；对上游 fetchOpenAIModels 的行为变化（错误消息不再透传响应 body、redirect 改为 manual 不跟随、新增 2MB 响应大小上限）属于有意的安全加固，且有测试固化（防止 API key 随重定向发往其他主机、防止上游错误 body 泄漏敏感信息），影响面仅限自定义 provider 的模型发现路径，不触及内置 openai/anthropic/google/kilo provider 的加载与认证（内置 provider 走 CLI 后端目录，不经过本模块）。custom-provider.ts 的 schema 演进保持向后兼容：VariantConfigSchema 由默认 strip 改为 passthrough，修复了上游会静默丢弃手写 variant 字段的问题；reasoningEffort 新增 "max" 与 CLI transform.ts 支持的取值一致；新增 limit/cost/websocket 字段均为 optional，不影响旧配置解析。测试覆盖充分：认证头、endpoint 拼接、/v1 去重、重定向拒绝、超时归一化、超大响应、错误 body 不泄漏、env 名注入防护、key 复用三重匹配（providerID+protocol+规范化 baseURL）、删除哨兵与 providerReset 交互均有断言。主要缺陷是 Anthropic/Gemini 模型发现未处理分页（会漏模型），以及 Gemini 路径的若干健壮性细节，见 findings。

**架构评价**：架构合理。协议元数据单表（CUSTOM_PROVIDER_META）设计使新增 provider 包只需加一行映射，webview 与 extension host 复用同一 shared 模块，避免了两侧规范化逻辑漂移；密钥复用要求 providerID、协议、规范化 baseURL 三者同时匹配，安全边界清晰。存在三处可改进的实现方案：1) Anthropic 与 Gemini 的 /models 接口均有分页协议（limit/has_more/last_id 与 pageSize/nextPageToken），当前实现只取默认第一页，应在 request 层支持分页游标循环或至少显式传最大 page size；2) fetch-models.ts 的 anthropicModelsURL 与 provider-model.ts 的 normalizeCustomProviderBaseURL 重复实现了 /v1 尾缀判断，而 gemini 分支却完全依赖调用方先规范化（无同款防御），更优方案是在 fetchModels 入口统一调用 normalizeCustomProviderBaseURL，删除各分支的临时防御；3) providerReset 与 withCustomProviderDeletions 是隐式成对契约（limit/cost 子字段删除依赖前者先整体置 null，后者的 limitPatch/costPatch 实际不看旧值），建议合并为一个返回 { reset?, patch } 的函数使契约显式化，避免未来调用方漏调 providerReset 导致已删除子字段在磁盘残留。providerReset 对 variants 采用顺序敏感比较触发全量重建，是为保证 deep-merge 后 variant 顺序与表单一致的有意设计，配有失败回滚，可接受。

## ui-dialog

**总体评价**：该域整体质量较高：新增能力（成本/limit 编辑、默认参数匹配、候选覆盖、WebSocket 开关、Gemini 包型）以 CustomProviderDefaults.ts / CustomProviderValidation.ts / CustomProviderVariants.ts 等纯函数模块承载，逻辑可测试且测试覆盖充分（4 个测试文件 55 用例全部通过，含 solid 响应式子进程验证晚到 catalog 重算）。“内置默认值只补空字段（mergeModelDefaults/apply）vs 候选点击全量覆盖（replaceModelDefaults）”的双路径语义与 README 描述一致并有测试锁定；成本成对校验、limit 成对校验、costEnabled 门控保存均实现正确；null 删除哨兵按设计放在扩展端 provider-actions.ts，webview 侧只输出干净配置对象（有 structuredClone 测试）。最小入侵方面存在两处偏离：ProvidersTab 删除了上游“Popular providers”区块（上游功能删除，README 未记载该决策，虽有专门测试锁定属有意为之），以及删除了上游导出符号 providerNoteKey，违反 README 维护原则 5。代码质量问题集中在 CustomProviderDialog.tsx：组件过大（1472 行）、apply/flag/field 与 mergeModelDefaults 重复实现同一“只补空字段”语义、逐键精确匹配可能残留错误模型的默认参数、候选覆盖后旧校验错误文案不清除等。对内置 provider 认证/加载路径无实质回归：ProviderConnectDialog/ProviderSelectDialog 改用 catalogProviders()（connected+catalog 超集，onMount 主动请求 catalog），时序上安全；校验中 existingProviderIDs 改为 catalog 全集与上游语义一致。

**架构评价**：架构总体合理：1) 把默认值匹配/候选排序（CustomProviderDefaults.ts）、保存前校验与序列化（CustomProviderValidation.ts）、variant 重排（CustomProviderVariants.ts）从组件中拆成无副作用纯函数，是正确的分层，webview 侧不持有已保存 API key（只发 providerID 由扩展端认证）也是好的安全边界。2) suggestion 信号只存查询条件、候选数组由 createMemo 基于完整 catalog 重算的设计正确解决了 catalog 晚到问题，并有专门测试。3) doFetch 的 fetchVersion 单调递增 + requestId 匹配 + ack/总超时双定时器，能正确丢弃过期响应；用独立 signal（fetchURL/fetchKey/fetchPackage）驱动自动发现、避免 Solid store 属性级订阅导致的误重跑，注释也解释了原因。可改进的更优实现：a) CustomProviderDialog.tsx 已达 1472 行，候选列表面板、hover 预览弹层（约 1120-1250、1400-1466 行）应拆为独立组件，doFetch 状态机可抽成 createModelDiscovery 之类的可复用 primitive；b) dialog 内 apply/flag/field 与 CustomProviderDefaults.mergeModelDefaults 是同一语义的两套实现，apply 可改为 setForm("models", i, mergeModelDefaults(model, defaults))（Solid store 合并写对未变化字段是无通知 no-op），消除语义漂移风险；c) 逐键触发的精确默认值应用建议改为在 ID 输入 blur/commit 时应用，或记录“自动填充来源 key”，当精确命中失效时回收自动填充值；d) defaultCandidates 每次按键全量扫描 catalog 并对每个模型做 3 次 score()（含正则 split），大 catalog 下可考虑缓存 parts(target) 或限制扫描范围，目前属可接受开销。

## hot-reload

**总体评价**：本域实现质量总体较高：config-refresh.ts 的快照 diff、per-provider version 防旧缓存回写、Semaphore 串行应用与原子替换的设计是自洽的，version 捕获点在所有 await 之前、状态突变集中在单个 Effect.sync 中，主链路没有发现可导致缓存错乱的竞态；ready.ts 确实只读 provider.list() 不实例化 SDK；openai-websocket.ts 的接管边界（仅自定义 provider + @ai-sdk/openai + 流式 /v1/responses + session affinity，标题请求经 TITLE_HEADER 强制走 HTTP）清晰且有真实 WebSocket 测试；/provider/ready 与其他 Kilo group 一致地挂载了 InstanceContext/WorkspaceRouting/Authorization 三层 middleware，无公开暴露问题。最小入侵方面：新逻辑基本落在 packages/opencode/src/kilocode/ 边界内，共享 provider.ts/transform.ts/config.ts 的触点均带 kilocode_change 标记，未删除或重命名上游导出符号，transform.ts 还把原先散落在共享文件里的 Kilo 变体逻辑下沉进了边界（净减少入侵面）。测试覆盖充分：热更新的新增/删除/修改、多实例、项目配置、连续快速保存、异步旧加载不回写等场景均有 live 测试。实质问题集中在三处：热更新路径绕过 disabled_providers/enabled_providers 会复活已禁用 Provider；配置 PATCH 与 auth 变更不再销毁实例的语义变化波及范围超出自定义 Provider（Agent/MCP 等配置派生缓存不会失效）；以及 build() 与全量构建约 90 行的复制导致已经出现的行为分叉（多 env var 的 key 解析）。

**架构评价**：架构选型合理：读路径统一收敛到 current()（先比配置快照引用，命中则直接返回，未命中先尝试增量 refresh，失败回退全量 invalidate+rebuild），把"新模型立即可用、删除模型不残留"变成读时保证而非事件驱动，避免了跨实例事件广播的一致性难题；增量守卫（非 catalog、source === "config"、非 OAuth）把内置 provider 和 OAuth 流程严格挡在完整重建语义里，对上游回归的防护是到位的；SDK 缓存 key 前缀化 + per-provider version 的组合让精确清理和防旧回写都能用同一把锁外的廉价检查完成。改进空间：1) build() 是 provider.ts 全量构建中 config-model 解析的手工拷贝（约 90 行），且已出现 env key 解析分叉；更优方案是把这段解析抽成 kilocode 边界内的共享纯函数，让全量构建以一行 kilocode_change 调用它，入侵面几乎不增而消除双份维护。2) 增量 refresh 应复用 isProviderAllowed 判定（或对 disabled/enabled 命中的 id 直接判非增量），当前实现绕过了该过滤。3) resolveSDK 对 WebSocket transport 这种带资源语义的对象缺少 single-flight，覆盖写会泄漏未关闭的 pool；可在 set 前 close 旧值或对同 key 加载去重。4) ready.check 失败即全局 ModelsRefresh.notify() 会让所有实例全量重建 Provider 状态，作为诊断接口建议改为仅失效当前实例，或对 notify 加节流。5) configUpdate/authSet 不再销毁实例的取舍（为 Remote-SSH 稳定性）对 Provider 域是安全的（current() 自愈），但对 Agent/MCP 等同样缓存配置派生状态的服务缺少对应的失效通道，建议在 diff() 返回 undefined（非 provider 配置变化）时保留销毁语义，或为这些 InstanceState 增加 global.config.updated 订阅。

## upstream-touch

**总体评价**：本域改动整体符合 README 维护原则：几乎所有共享文件补丁都有 kilocode_change 标记或位于既有标记块内，重量级逻辑（增量刷新、WebSocket transport、GLM-5.2 变体、waitForServer）均下沉到 packages/opencode/src/kilocode/ 边界，上游导出符号未删除或重命名（invalidateAfterProviderAuthChange、disposeAllInstancesAndEmitGlobalDisposed 等仅扩展了可选参数），public.ts 的 SDK schema 补丁也完整保留了上游 variants 处理。测试补充较充分（variant 顺序、stale 后台刷新、single-flight、recovered 通知均有覆盖），cli-shutdown 测试从 mock.module 改为 spyOn 是质量改进。核心配置热更新（Provider.current 读取前同步配置 + per-provider version 防回写 + 信号量串行）设计自洽，null 删除哨兵在 v1 schema 放宽与 migrate 折叠两侧对称且有测试。主要问题集中在上游回归面：waitForServer 无条件 ppid 孤儿检测会杀死手动后台启动的 kilo serve（与上游 parent-watchdog 的 KILO_PARENT_PID 门控设计直接矛盾）；configUpdate 端点和 auth set/remove 移除了上游"配置/认证变更即销毁全部实例"的语义，Config/Provider/Agent 有热重建路径兜底，但 MCP 等在实例构建期快照配置的服务不会感知；dispose 超时分支放弃了 uninterruptible 并可能吞掉 global.disposed 事件；model-cache 的 stale 判断把失败留下的空对象也当作可用缓存，改变了失败恢复时序。少量瑕疵：config.ts 中 loadGlobal 改名为 loadSnapshot 的那一行本身缺少内联标记，且 check-opencode-annotations.ts 在 merge 历史下自动跳过、未实际验证本轮标记覆盖；build-node.ts 作为上游脚本被整体删除（虽无任何引用，但会增加后续合并摩擦）。

**架构评价**：架构方向合理：把"配置快照对比 → 精确替换目标 Provider"（config-refresh.ts）、per-provider version 防旧异步回写、SDK 缓存 key 加 providerID 前缀以支持精确清理，这套组合能实现不重启后端的自定义 Provider 热更新，且 diff() 在存在非 provider 变化或 OAuth/目录 Provider 时回退全量重建，边界清晰。但有三点可以做得更好：1) Provider.current() 用服务级单信号量串行化所有目录实例的全部 Provider 读取，且临界区内嵌 config.get()（每次读 6 个配置文件做 stamp）甚至可能触发含网络请求的全量状态重建——更优方案是无锁快速路径（先读缓存并比较 config 引用，仅在检测到变化时进锁），锁粒度按 directory 划分；2) config-refresh.ts 的 build() 与 provider.ts create() 中自定义 Provider 编译逻辑近乎整段重复，增量产物必须与全量重建产物逐字段一致，应抽成单一共享编译函数，否则每次上游升级都要人工对照两处；3) 实例销毁语义的削弱（configUpdate、auth 变更、dispose 超时）是为 Remote-SSH 稳定性做的取舍，但缺少系统性兜底：热重建目前只覆盖 Config/Provider/Agent 三个有版本检查的服务，更稳妥的做法是保留按需 dispose 的显式参数（如上游 dispose 选项）或为 ConfigUpdated 事件建立服务端订阅失效机制，而不是默认全部走"只失效缓存"。

## model-visibility

**总体评价**：本域改动整体质量较高：isVisibleModel/isModelValid 单一入口确实被所有模型展示与选择路径复用（ModelSelector、MultiModelSelector、NewWorktreeDialog、ModelsTab、ModeEditView、KiloNotifications、resolveModelSelection、会话覆盖与 pending Kilo 模型防御），逐一核查了全部 useProvider 消费点，未发现绕过过滤的新模型选择入口；直接读取 provider.providers() 全量目录的路径（TaskUsage、model-usage、DataBridge、catalogProviders 系列）均为历史消息名称展示或 provider 连接目录，不构成选择入口，符合 README 的设计约定。provider.tsx 以纯函数 applyProviderMessage + 单调 revision 合并增量状态、拒绝迟到快照，catalog 与 connected 分离并各自防迟到，逻辑正确且测试覆盖充分；FAVORITES_SEEDED_KEY 默认收藏语义（首次注入、清空后不恢复）实现正确。主要问题有三：(1) 高危——createStaleModelPruner 会把"当前不可见"的收藏/最近模型/per-agent 选择永久持久删除（toggleFavorite remove、clearModelSelection、persistRecents），而用户主动断开 provider（providerDisconnected removed=false）、kilo gateway 瞬时拉取失败（扩展端 kilo 缺失时仍下发 connected 快照并仅安排重试）都会触发，重连后数据不恢复且默认收藏因 seeded 标记不再注入，属上游回归（上游断开只隐藏不删除）；(2) buildTriggerLabel 行为变化使设置页在配置模型暂不可见时显示"Not set"而非配置的原始值，掩盖真实配置；(3) server.tsx 为一行行为变化做了整文件重构，违反最小入侵原则。最小入侵评价：核心文件（provider.tsx、session.tsx、ModelSelector.tsx）改动集中在 packages/kilo-vscode 边界内且新逻辑多拆到独立新文件（session-model-prune.ts、session-preference-recovery.ts），未删除或重命名上游导出符号，validateFavorites 还保留了兼容壳，符合维护原则；但 server.tsx 的整体函数化重构和 ProvidersTab 删除上游 popular providers 区块扩大了后续合并冲突面。

**架构评价**：架构设计总体合理且优于常见做法：(1) 可见性判断收敛到 provider-utils.ts 的 isVisibleModel/isModelValid 单一入口，isModelValid 直接基于 isVisibleModel 实现，语义天然一致；provider context 同时暴露 models（全量）与 visibleModels（过滤后）两个 memo，findModel 改为只在 visibleModels 中查找，使默认路径安全、需要全量时必须显式使用 models()，方向正确。(2) applyProviderMessage 以纯函数 + 单调 revision 实现增量合并与迟到拒绝，connected 权威快照整体替换、providerConnected/Disconnected 精确变更、catalog 快照仅补充认证元数据且独立 catalogRevision 防迟到，与扩展端共享 revision 计数器配合正确，多 Webview 同步场景可推演验证，测试覆盖了迟到快照恢复已删模型等关键路径。(3) 会话层防御分层清晰：读取路径（resolveModelSelection/sessionModel/recoverModel）全部 validate 并回退、写入路径（applyModel/setSessionModel）拒绝无效值、providers 未加载时豁免避免启动竞态误清。存在更优实现方案的点：一是持久化清理不应放在 webview 的响应式 effect 中——读取与展示路径已全面过滤回退，createStaleModelPruner 的永久删除收益极小而风险高，更优方案是仅做内存隐藏，把持久数据清理移到扩展端在权威且稳定的时机（如确认 provider 配置被删除而非仅断开/瞬时缺失时）执行；二是 provider.tsx 混入了约 200 行纯状态机逻辑，抽到独立 .ts 模块（如 provider-state.ts）既降低单文件复杂度，也能让 provider-context.test.ts 直接 import 测试而不必用 Bun.spawnSync 内嵌字符串脚本；三是"providers 为空即全部有效"的豁免逻辑在 session.tsx、NewWorktreeDialog.tsx、session-model-store.ts 三处重复实现，应合并为共享 helper；四是 ProviderState 中 optimistic/optimisticAuth 字段无任何消费方，属于未完成或已废弃的设计残留，应删除或补全。

## agents-i18n

**总体评价**：本域改动整体质量高、入侵面小，严格遵守了 README 维护原则。git diff 确认 packages/opencode/src/agent/agent.ts、packages/opencode/src/kilocode/agent/index.ts、packages/kilo-indexing/src/indexing/orchestrator.ts 零改动，即"只改 UI 展示，不改 agent 内部 name 和系统 prompt"的边界被严格执行。中文化通过 webview 展示层的 agentDescription()/agentLabel() 映射到 i18n key 实现，仅覆盖 ask/code/debug/explore/general/plan 六个内置 agent；用户自定义 agent（native === false）不会被翻译，同名自定义 agent 的 description 也会保留（有专门测试覆盖）。隐藏 orchestrator 通过新增 src/shared/agents.ts 的 HIDDEN_AGent_NAMES 单一来源实现，host 端 filterAgents 与 webview 端 isHiddenAgent 双端语义完全一致（native !== false 且名字命中才隐藏），且核心定义未删除。上游导出符号 filterVisibleAgents 签名保持不变，仅扩展过滤逻辑；被移除的 formatAgentLabel 是 ModeSwitcher.tsx 内部私有函数，迁移为共享 agentLabel 属合理重构。i18n 方面 agent.description.* 六个 key 在 en/zh/zht 三份文件一致存在，其余 17 个 locale 依赖 language.tsx 的英文回退机制，i18n-keys.test.ts 用 APP_PLUS_KEYS 豁免这些 key 但仍强制 zh/zht 完整，取舍合理。测试覆盖充分：agent-display.test.ts、kilo-provider-utils.test.ts、i18n-keys.test.ts 共 97 个用例全部通过，覆盖了 native false 保留、native undefined 防御性过滤、subagent/hidden 过滤、displayName 优先、同名自定义 agent 保留等关键分支。发现的问题均为低严重度：存量 default_agent=orchestrator 配置的降级体验、"保留同名自定义 orchestrator"分支在真实后端数据流中不可达、welcome 文案品牌跨语言不一致、README 描述与 fetchAndSendAgents 实现不符。

**架构评价**：架构合理。将 HIDDEN_AGENT_NAMES 集中到 packages/kilo-vscode/src/shared/agents.ts 作为单一事实来源，webview 通过既有的 ../../../src/shared 导入模式（work-style.tsx、session.tsx、provider-utils.ts 均有先例）复用，避免了双端硬编码漂移；host 端 filterAgents（agent.native === false || !HIDDEN_AGENT_NAMES.has(name)）与 webview 端 isHiddenAgent 的隐藏条件语义一致，自定义 agent 保护方向正确。展示逻辑收敛到 utils/agent-display.ts 后，ModeSwitcher（聊天选择器）、agent-manager 的 NewWorktreeDialog（复用 ModeSwitcherBase）和 AgentBehaviourTab 自动共享同一套本地化，消除了原先 formatAgentLabel 的重复。可改进之处：(1) 当前 allAgents 未在 host 端过滤，orchestrator 仍随 agentsLoaded 下发到 webview，隐藏依赖每个消费 allAgents 的 UI 入口自行调用 isHiddenAgent（目前只有 AgentBehaviourTab 做了，ModeEditView 直接用 allAgents().find 但入口受控）——更稳妥的方案是在 mapAgent 下发前统一过滤或在 session context 的 allAgents accessor 处集中过滤，把防御收敛到单点；(2) filterVisibleAgents 的 defaultAgent 回退取 visible[0]，当用户 default_agent 恰为被隐藏的 orchestrator 时会回退到按字母序第一个 agent（通常 ask）而非更符合预期的 code，建议回退时优先在 visible 中查找 "code"。总体而言实现方案与"最小入侵 + 边界内实现"的目标匹配，无需推翻重做。

## misc-infra

**总体评价**：本域改动分三块：(1) cli-backend 连接层大改：server-manager.ts 引入跨窗口共享 CLI 后端（目录锁 server-start.lock + 状态文件 server-start.json + pid/HTTP 双重存活检查），connection-service.ts 新增单飞 recover 自动重连、健康检查连续失败计数、disposed 防护、connect 取消回调，以及 Provider 密钥缓存/revision 广播/串行保存队列（为 provider 热更新服务）；(2) 文件工具链改造：文件 mention 从 webview 端拼 file:// URL 改为传相对 path、由扩展端 resolveMessageFile 按会话真实目录解析（修复 worktree/agent-manager/远程场景下附件解析到错误 workspace 的问题），parseMessageFiles 由整组失败改为逐项容错；(3) 发布基础设施：publish-zlfcode.yml 新建（带 kilocode_change 标记）、check-release.ts 版本映射校验（A.B.C-v0.NN → A.B.CNN 映射为单射，逻辑正确）、esbuild.js 修复 Remote Extension Host 的 navigator 迁移保护与 debug 包入口误选、package.json 身份改名（命令 ID/视图 ID 均未动，符合维护原则第 6 条）、local-bin.ts 增加 --strict 防止 wrapper 二进制进发布包、各面板图标改用 zlfcode-logo.svg、MarketplacePanelProvider 修复硬编码 kilocode.kilo-code 导致版本显示 unknown 的问题。最小入侵评价：改动基本集中在 packages/kilo-vscode 边界内，共享文件 packages/extensions/zed/extension.toml 有 kilocode_change 标记；但 packages/tui/src/kilocode/session-mentions.ts 存在纯空行删除的无意义 diff，packages/kilo-gateway/src/api/profile.ts 的 5 秒超时补丁（本身是合理修复）未加 kilocode_change 标记。代码质量总体良好：新逻辑配有完整单测（server-manager 共享启动并发、connection-service 自动恢复/取消/队列、message-files/file-mention 各边界用例），竞态防护（引用比对、单飞、串行队列、mkdir 原子锁）细致；主要缺陷集中在共享后端生命周期：崩溃自动重连无退避上限、健康检查假阳性会删除共享状态文件或杀掉共享进程组、owner 窗口关闭直接杀掉其他窗口正在使用的后端。上游回归风险：内置 provider 路径、认证与配置迁移未受影响；sdk 生成物改动与源（/provider/ready、上游 v7.4.11/16 合并）对应一致，sdk 包版本已同步为 7.4.1603；esbuild 的 define navigator=undefined 影响整个扩展主 bundle（含上游依赖），依赖 typeof navigator 探测的库会正确走 Node 分支，风险可控。

**架构评价**：共享后端架构（多窗口复用同一 kilo serve 进程）在没有独立守护进程的约束下是合理折衷：mkdir 原子锁 + owner pid 判废 + mtime 判 stale + HTTP 健康确认的组合较完善，getSharedServer 对 pid 复用也有 HTTP 二次确认；connection-service 的单飞 recover、连接取消回调（connectCancel）和引用比对（config/client/sse 三重校验）竞态处理细致，测试覆盖到位。文件 mention 改为相对 path + 扩展端按会话目录统一解析，是正确的架构方向（解析点唯一化，webview 不再依赖缓存的 workspaceDir）。但共享后端生命周期存在结构性弱点，有更优实现方案：(1) 共享后端没有引用计数或所有权移交机制——owner 窗口 dispose 时直接 SIGTERM 进程组，且 KILO_PARENT_PID watchdog 绑定 owner 扩展宿主，导致 owner 关窗必然中断其他所有窗口的后端（进行中的流式生成被杀），只能靠其他窗口 30 秒级 health-poll 触发 recover 重建；建议引入所有权移交（owner 退出时由存活窗口接管重新 spawn 并更新状态文件）或至少缩短非 owner 窗口的死亡检测路径。(2) recover 自动重连没有指数退避和次数上限，后端反复崩溃时会形成无节流的 spawn 循环（上游原行为是停在 error 状态等用户手动重试）。(3) 健康检查假阳性（本窗口 3 次 HTTP 超时但后端实际存活）会走 dropInstance 删除共享状态文件甚至杀进程组，破坏性过强；更稳妥的做法是非 owner 窗口失败时仅放弃本窗口连接并重读共享状态，不删除全局状态文件。发布校验方面 check-release.ts 的批次→市场版本映射是单射且被 workflow 强制执行，设计可靠。


---

# 第二轮复审（2026-07-30，修复批次审核）

审核对象：针对第一轮 59 条发现实施的全部修复代码（工作区相对 `a09ec74c39` 的未提交修改，77 个文件，约 +3309/-767 行）。
审核方法：按 6 个功能域并行深审（opencode 生命周期、Provider 热更新与编译、扩展宿主与连接层、shared 模型发现、webview UI、脚本与发布），每域对照第一轮条目的"处理记录"逐条核对代码与测试，并叠加对 6168 行 diff 的独立全量通读、类型检查与测试对拍。

## 第一轮修复验证结论

59 条处理全部核实与记载一致，无一条虚报：53 条"已修复"逐条确认代码真实落地、测试具备红-绿区分性；3 条"保守处理"（F15/F20/F52）缓解措施与记载相符；3 条"接受现状"（F33/F34/F49）理由在代码中得到印证。测试对拍：`tests/unit` + connection-service 共 3554 通过 / 1 失败（唯一失败为第一轮已记载的 WorktreeManager 需真实 git fetch 的预存环境失败）；`test/provider/` 428 条全过；两包 `tsc --noEmit` 通过。

## 第二轮统计与处理结果

| 级别 | 数量 | 编号 |
|---|---|---|
| 低 | 16 | F60-F75 |

无高/中级别新发现。2026-07-30 完成全部 16 条处理：**15 条已修复、1 条保守处理（F69）**。

---

# 第二轮发现明细

### F60【低/缺陷】resolveMessageFile 的越界判定误拒以 ".." 开头命名的文件

- **域**：ext-host
- **位置**：`packages/kilo-vscode/src/kilo-provider/message-files.ts:58`
- **来源**：第一轮 F55 修复引入的行为收窄
- **处理状态**：**已修复**

**处理记录**：越界判定从 `rel.startsWith("..")` 收紧为 `rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)`，区分「路径段就是 ..」与「文件名恰好以 .. 开头」。新增测试覆盖绝对路径与相对路径两种形式的 `..config` 文件均可正常附加。

**修改文件**：`packages/kilo-vscode/src/kilo-provider/message-files.ts`、`packages/kilo-vscode/tests/unit/message-files.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/message-files.test.ts tests/unit/fetch-models.test.ts tests/unit/file-mention-utils.test.ts tests/unit/use-file-mention.test.ts → 151 pass / 0 fail；复审后补充 `rel === ".."` 分支的边界用例（附件 path 恰为父目录本身），message-files.test.ts 最终 14 pass

**问题描述**：F55 的归属校验用 `rel.startsWith("..")` 判定越界，但 `path.relative("/repo/worktree", "/repo/worktree/..config")` 返回 `"..config"`，同样以 `..` 开头——会话目录内名为 `..config` 之类的文件被误判越界而静默丢弃（修复前此类文件可正常附加）。触发面极小（此类文件名罕见）且失败模式温和（模型仍可经 Read 工具读取），judged low。

### F61【低/流程】F13/F15 的关键回归测试不在 CI 覆盖范围内

- **域**：misc-infra
- **位置**：`packages/kilo-vscode/package.json`（test:unit script）
- **处理状态**：**已修复**

**处理记录**：`test:unit` 命令从 `bun test tests/unit/ --dots` 扩展为追加 `src/services/cli-backend/connection-service.test.ts`。该文件位于 src/ 下属既有布局（HEAD 已如此），但第一轮为 F13 退避上限、F15 快速探测新增的 8 个并发敏感测试都落在这个文件里，扩大了 CI 盲区，故将其纳入 CI 入口（.github/workflows/test-vscode.yml 的 `bun run test:unit` 即自动覆盖，workflow 本身无需修改）。

**修改文件**：`packages/kilo-vscode/package.json`

**测试**：cd packages/kilo-vscode && bun run test:unit（含 connection-service.test.ts）→ 最终工作区实跑 3560 pass / 1 fail（较第一轮的 3554 多出的 6 个为本轮 F60/F64/F65/F70 新增测试；唯一失败为既有 WorktreeManager 环境失败，与本次无关）

**问题描述**：CI 对 kilo-vscode 只运行 `bun test tests/unit/`，主 test.yml 的 general 矩阵显式排除 `packages/kilo-vscode/**`；connection-service.test.ts 不被任何 CI 入口执行，F13/F14/F15 的关键回归保护仅能本地手动运行。

### F62【低/回归残余】F07 超时分支在调用方 fiber 被外部中断时事件仍会丢失

- **域**：upstream-touch
- **位置**：`packages/opencode/src/server/global-lifecycle.ts:26`
- **来源**：第一轮 F07 修复的残余缺口（复审 agent 用 Effect 运行时实证）
- **处理状态**：**已修复**

**处理记录**：超时分支从 `Effect.uninterruptibleMask + restore` 结构改为 `dispose.pipe(Effect.timeoutOrElse(...), Effect.ensuring(emitGlobalDisposed))`：finalizer 天然不可中断，且在成功、超时中断、调用方 fiber 被外部中断（如 HTTP 层传播请求取消）三种收尾路径下都会运行，事件必然发出；结构同时比原写法更简洁。非超时分支保持整体 uninterruptible 不变。新增测试「超时分支在调用方 fiber 被外部中断时仍然发出 global.disposed 事件」（forkChild + Fiber.interrupt 场景）。

**修改文件**：`packages/opencode/src/server/global-lifecycle.ts`、`packages/opencode/test/kilocode/global-lifecycle.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/global-lifecycle.test.ts → 4 pass / 0 fail

**问题描述**：F07 修复用 uninterruptibleMask 的 restore 区域恢复了外部可中断性——若调用方 fiber 在销毁进行中被外部中断，中断在 restore(dispose) 内立即生效，后续 emitGlobalDisposed 不执行；上游整体 uninterruptible 形态下外部中断被推迟、事件必发。复审时已实证：复刻修复结构 + Fiber.interrupt 后事件列表为空。

### F63【低/质量】F56 修复后两处旧文档与新逻辑方向相反

- **域**：misc-infra
- **位置**：`.kilo/agent/upstream-merge.md` 第 10 节、`script/sync-versions.ts` 文件头
- **处理状态**：**已修复**

**处理记录**：upstream-merge.md 第 10 节移除「脚本会改写 zed extension.toml」的说明与「保留上游版本会 404」的旧因果（与 F56 修复结论恰好相反），补充 ZLF 警示段：该文件已被有意排除、必须保持 Kilo-Org 上游底座版本、不要手动"纠正"、check-release.ts 会拦截误写。sync-versions.ts 头部英文 "Why this exists" 段同步修正，并注明历史注释与现行结论的方向差异已随 F56 一并纠正，消除同文件内新旧注释互相矛盾。

**修改文件**：`.kilo/agent/upstream-merge.md`、`script/sync-versions.ts`

**测试**：纯注释/文档修正，无行为变化；bun run script/check-md-table-padding.ts → 391 文件通过

**问题描述**：upstream-merge.md 仍说 sync-versions "rewrites … plus the Zed extension toml" 且称保留上游版本会使下载地址 404——会误导下次执行上游合并的操作者手动把 zed toml"纠正"回坏状态；sync-versions.ts 头部英文注释保留同样旧说法，与同文件新中文注释自相矛盾。

### F64【低/质量】Gemini 分页缺少 Anthropic 同款的空页终止条件

- **域**：shared-helpers
- **位置**：`packages/kilo-vscode/src/shared/fetch-models.ts`
- **处理状态**：**已修复**

**处理记录**：Gemini 分页循环终止条件追加 `pageItems.length === 0`，与 Anthropic 分支对称：异常 endpoint 用不断变化的 nextPageToken 配空 models 数组时立即终止，不再空转拉满 10 页上限。新增测试「空页即使返回新 token 也立即停止」（断言 requests === 1）。

**修改文件**：`packages/kilo-vscode/src/shared/fetch-models.ts`、`packages/kilo-vscode/tests/unit/fetch-models.test.ts`

**测试**：含于 F60 的 4 文件批跑 → 151 pass / 0 fail

**问题描述**：Anthropic 分支终止条件含空页检查而 Gemini 只查 token 缺失/不变，两分支防御不对称；有 MAX_FETCH_PAGES 兜底不构成死循环，仅健壮性瑕疵（最多多 9 次无效请求）。

### F65【低/架构】buildTriggerLabel 新参数默认值为 fork 语义，上游合并新增调用点会静默偏离上游行为

- **域**：model-visibility
- **位置**：`packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts`
- **来源**：第一轮 F11 修复的默认值方向问题
- **处理状态**：**已修复**

**处理记录**：默认语义反转为上游行为：`buildTriggerLabel` 第 9 参数默认值从 `"resolved"` 改为 `"configured"`（＝上游 v7.4.16 raw 兜底显示），`ModelSelectorBase` 的 `labelSemantics` prop 默认同步改为 `"configured"`；"resolved" 收窄改为由聊天路径显式声明——主聊天 `ModelSelector` 包装组件与 `NewWorktreeDialog` 显式传 `labelSemantics="resolved"`，设置页 7 处既有的显式 `"configured"` 保留。这样未来上游合并新增的调用点（不会传本 fork 新增的参数）自动获得上游行为。测试更新：8 参调用改为断言 configured 行为（F65 新测试），resolved 断言改为显式传参；新增 F65 源码守卫锁定聊天两处显式传参与组件默认值，防止上游三方合并丢失显式声明。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/shared/model-selector-utils.ts`、`ModelSelector.tsx`、`packages/kilo-vscode/webview-ui/agent-manager/NewWorktreeDialog.tsx`、`packages/kilo-vscode/tests/unit/model-selector-utils.test.ts`

**测试**：cd packages/kilo-vscode && bun test tests/unit/model-selector-utils.test.ts tests/unit/custom-provider-defaults.test.ts → 71 pass / 0 fail

**问题描述**：第一轮 F11 给 buildTriggerLabel 增加语义参数时默认值取了 fork 新行为（resolved：隐藏未解析 raw），上游行为反而需要显式传参；若未来上游新增调用点（不传第 9 参），三方合并后将静默获得 fork 语义而非上游预期的 raw 兜底显示。

### F66【低/入侵性】F37 修复的两行上游替换落在 kilocode_change 标记块外

- **域**：upstream-touch
- **位置**：`packages/opencode/src/provider/provider.ts`（env key 解析循环）
- **处理状态**：**已修复**

**处理记录**：`// kilocode_change end` 标记下移，把 `if (!resolved.found) continue` 与 `key: resolved.key` 两行（对上游原 `if (!apiKey) continue` / `key: provider.env.length === 1 ? apiKey : undefined` 的替换）一并圈进标记块，并在注释中说明两行同属本 fork 的替换范围。

**修改文件**：`packages/opencode/src/provider/provider.ts`

**测试**：cd packages/opencode && bun test test/provider/ → 428 pass / 0 fail（行为无变化，纯标记调整）

**问题描述**：F37 修复把 end 标记放在 `resolveEnvApiKey` 调用行之后，但紧随的两行同样替换了上游未标记原行，却不在任何标记块内——合并上游时这两行冲突无标记提示，与第一轮处理记录「三处调用点均加 kilocode_change 标记」不完全相符。

### F67【低/架构】compileProviderInfo 丢失 HEAD 版 build() 的防御性浅拷贝，可变性契约未警示

- **域**：hot-reload
- **位置**：`packages/opencode/src/kilocode/provider/compile.ts:37`
- **处理状态**：**已修复**

**处理记录**：评估后保留共享引用语义（这是刻意对齐上游全量构建的行为，改为浅拷贝反而使 compile 与全量语义不再逐字段一致），改为在 JSDoc 显式写明可变性契约：返回值的 models 与 base.models 是同一引用、compileConfigModels 会就地写入、调用方绝不能把运行时注册表中仍在使用的 provider 对象直接作为 base 传入（需先深拷贝）；并注明当前两个调用方（全量构建传本轮新建的 database 条目、增量刷新不传 base）均安全。

**修改文件**：`packages/opencode/src/kilocode/provider/compile.ts`

**测试**：纯注释；对拍测试（provider-config-refresh.test.ts「增量刷新产物与重启后全量重建产物逐字段一致」）保持通过

**问题描述**：HEAD 的 config-refresh.build() 有 `models: { ...(input.base?.models ?? {}) }` 浅拷贝，F10 统一后的 compileProviderInfo 为 `models: input.base?.models ?? {}`（共享引用就地写入）。当前调用方不可达，但 build() 是导出函数，未来若被传入活动 state 中的 provider 作为 base 会就地污染运行时对象，而注释未警示。

### F68【低/缺陷】SDK 加载与实例销毁/热更新之间的两处竞态窄窗口

- **域**：hot-reload
- **位置**：`packages/opencode/src/provider/provider.ts`（resolveSDK/finalizer）、`packages/opencode/src/kilocode/provider/config-refresh.ts`（清理循环）
- **来源**：第一轮 F38/F43 修复后的残余
- **处理状态**：**已修复**

**处理记录**：三项修复。(1) 实例销毁防注册：State 新增 `lifecycle: { disposed: boolean }` 字段，WebSocket finalizer 置位 disposed，resolveSDK 的 version 防回写检查追加 `!s.lifecycle.disposed`——实例销毁不 bump version，销毁后完成的 in-flight 加载不再把新 transport 注册进已 close/clear 的连接池（其 pruneTimer 将无人清理）。(2) sdkLoads 纳入热更新清理：Runtime 类型新增 sdkLoads 最小结构接口（keys/delete），refresh 清理循环按 `${id}/` 前缀删除 in-flight 条目——热更新只改 models 不改 options 时 SDK key 不变，不清除会让刷新后的新调用命中旧 in-flight、拿到"version 失配不入缓存且内嵌已 close transport"的 SDK。(3) 连锁修复：resolveSDK 的 finally 从无条件 delete 改为「仅当条目仍指向本次 loadPromise 时删除」——外部清理后同 key 可能已被新一轮加载占用，无条件 delete 会误删新条目、破坏新加载的 single-flight 去重（该问题由本次外部清理引入，实施中同步发现并修复）。

**修改文件**：`packages/opencode/src/provider/provider.ts`、`packages/opencode/src/kilocode/provider/config-refresh.ts`、`packages/opencode/test/kilocode/provider-config-refresh.test.ts`（make() 补 sdkLoads 字段；复审后补充针对性测试）

**测试**：cd packages/opencode && bun test test/kilocode/provider-config-refresh.test.ts → 20 pass / 0 fail（含复审后新增的「增量刷新清除目标 Provider 的 in-flight SDK 加载条目」单元测试，断言目标前缀条目被删、其他 Provider 条目保留、version 同步 bump）；test/provider/ → 428 pass / 0 fail；tsc --noEmit 通过。测试方式说明：三项修复中 (1) disposed 防注册与 (3) finally 条件删除位于 resolveSDK 内部闭包、无低风险注入点，以推演＋既有回归＋类型检查佐证；(2) sdkLoads 前缀清理有上述针对性红-绿测试。

**问题描述**：(a) 实例销毁不 bump version：finalizer close/clear websockets 后，in-flight loadPromise 完成时 version 检查（v0===v0）仍通过，将新 transport 注册进已死的 Map，pruneTimer interval 无人 clearInterval（unref 空转）；(b) s.sdkLoads 未纳入增量清理：热更新后同 key 调用可拿到"未缓存且内嵌已 close transport"的 SDK（WebSocket Responses Provider 场景下本次请求经已 close 的 pool 打开不受管理的连接，下次调用自愈）。两处均为 F38/F43 修复净改善下的窄窗口残留。

### F69【低/质量·预存】test/kilocode/server/ 整目录连跑存在 6 个测试隔离失败

- **域**：misc-infra
- **位置**：`packages/opencode/test/kilocode/server/permission-allow-everything.test.ts`（污染源）等
- **来源**：fork 基线预存缺陷，非本修复批次引入（复审时排查确认）
- **处理状态**：**保守处理**

**处理记录**：根因链完全查明并实证：(1) `Server.Default()` 与 `HttpApiApp.webHandler` 是进程级 lazy 单例，认证配置（ServerAuth.Config 读 KILO_SERVER_PASSWORD）在单例首次构建时解析一次并被共享 memoMap memo；(2) `lazy.reset()` 无法绕开——重建的 handler 经同一 memoMap 拿回旧 auth config（探针实证：reset 后重设密码再请求仍 401）；(3) `/permission/allow-everything` 属 REQUIRED_AUTH_PATHS（fail-closed）：单例在无密码状态构建后该端点无论携带什么凭据一律 401，反之 permission 测试先构建带密码单例后，cloud-session-import 等文件的无凭据请求全部 401——三组测试对同一单例的认证状态期望互斥，同进程连跑必有一方失败。影响范围：仅本地整目录连跑；CI 经 script/test-runner.ts 按文件 shard 分进程执行不受影响；单独运行各文件语义完整且通过。彻底修复需要为测试提供非单例 webHandler 工厂（独立 memoMap）并适配 fixture 实例路由、或引入按文件的进程隔离，属测试基建重构且非本批次引入，另立任务处理。本轮已在污染源测试文件顶部写入完整根因注释（含排查结论、影响范围、修复方向），防止后续把整目录连跑的 401 误判为代码回归。

**修改文件**：`packages/opencode/test/kilocode/server/permission-allow-everything.test.ts`（仅注释）

**测试**：bun test test/kilocode/server/permission-allow-everything.test.ts（单独运行）→ 3 pass / 0 fail；整目录连跑仍为 83 pass / 6 fail（预期内，见处理记录）

**问题描述**：整目录连跑时 permission-allow-everything 1 条、cloud-session-import 4 条、prompt-training-model-filter 1 条失败；三个文件均无本批次修改、单独运行全部通过，为进程级单例认证状态的跨文件耦合所致。

### F70【低/质量】pagedURL 注释失实且畸形 baseURL 抛原生 TypeError

- **域**：shared-helpers
- **位置**：`packages/kilo-vscode/src/shared/fetch-models.ts`（pagedURL）
- **处理状态**：**已修复**

**处理记录**：注释修正为与实际防线一致（baseURL 只经 webview 弱正则与扩展端 typeof 检查，无完整 schema 校验）；`new URL` 包入 try/catch，畸形输入统一抛 `FetchModelsError("Invalid base URL")`，调用方 catch 后回发 webview 的错误文案保持语义化。新增畸形 baseURL 测试。

**修改文件**：`packages/kilo-vscode/src/shared/fetch-models.ts`、`packages/kilo-vscode/tests/unit/fetch-models.test.ts`

**测试**：含于 F60 的 4 文件批跑 → 151 pass / 0 fail

**问题描述**：注释声称「baseURL 已通过 schema 校验为合法 http(s) URL」不实——扩展端入口仅 `typeof === "string"` 校验；异常输入时 `new URL` 抛原生 TypeError（被上层 catch 后果无害，但错误文案不如既有 FetchModelsError 语义化）。

### F71【低/质量】check-release 对 zed extension.toml 仅校验 version 行，archive URL 不在校验范围

- **域**：misc-infra
- **位置**：`script/zlfcode/check-release.ts`
- **处理状态**：**已修复**

**处理记录**：新增 `zedArchiveURLs` 校验：正则提取文件内所有 `releases/download/vX/` 下载地址的版本段（不限域名，fail-closed 取向——当前只有 Kilo-Org 地址；复审后已同步修正注释与实现表述一致），逐一要求等于上游底座版本（meta.base），不等则报错并指明实际/期望版本；文件缺失由既有 version 行校验统一报告，URL 为零个时不误报（兼容测试 fixture 的极简 toml）。新增测试「archive URL 版本被单独改坏时校验失败」（version 行正确 + 一好一坏两个 URL，断言仅坏 URL 报错）；实测正则对真实 extension.toml 的 5 个 URL 全部命中。

**修改文件**：`script/zlfcode/check-release.ts`、`script/zlfcode/check-release.test.ts`

**测试**：cd script && bun test zlfcode/check-release.test.ts → 5 pass / 0 fail；bun run script/zlfcode/check-release.ts zlfcode-v7.4.16-v0.03 实跑通过

**问题描述**：F56 修复的注释声称「防止 archive URL 指向不存在的 release」，但 contains 只检查 version 行子串；若 URL 中的版本被单独改坏（如合并冲突解决失误）而 version 行正常，校验闸门挡不住。

### F72【低/入侵性】model-cache.ts 三处 ZLF 修改无行内 kilocode_change 标记

- **域**：upstream-touch
- **位置**：`packages/opencode/src/provider/model-cache.ts`（evaluate 两处 Clock、fetch 的 stale 判断）
- **处理状态**：**已修复**

**处理记录**：三处修改补行内标记：evaluate 的 cached 过期判定与 expires 计算两处（F45）分别用单行式与 start/end 对标记，fetch 的非空 stale 判断（F08）用单行式标记。该文件头部虽为 Kilo 的 `kilocode_change - new file`（相对 sst/opencode 整文件新增），但 ZLF 相对 Kilo 的修改点补标记后与本 fork 其他共享文件的圈定做法一致，便于合并 Kilo 上游时辨识。

**修改文件**：`packages/opencode/src/provider/model-cache.ts`

**测试**：cd packages/opencode && bun test test/kilocode/model-cache-effect.test.ts → 16 pass / 0 fail（纯注释）

**问题描述**：F08/F45 的三处修改仅以中文注释区分，无 kilocode_change 标记，与本 fork 在其他共享文件用标记圈定自身改动的做法不一致。

### F73【低/质量】revertAutoFill 无法区分"用户手改为与自动填充恰好相同的值"

- **域**：ui-dialog
- **位置**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDefaults.ts`（revertAutoFill）
- **处理状态**：**已修复**（限制说明入档）

**处理记录**：深比较方案的固有取舍，不引入逐字段来源标记（会显著增加行级状态复杂度）；在 revertAutoFill 的 JSDoc 补已知限制说明：回收判据是结构相等，用户清空后手动输入与填充值恰好相同的值也会被回收；触发场景罕见、回收结果在表单中直接可见可立即重输，不影响「错误默认值不被静默保存」的核心目标。

**修改文件**：`packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDefaults.ts`

**测试**：纯注释；custom-provider-defaults.test.ts 保持通过

**问题描述**：见处理记录。

### F74【低/质量】F01 测试对"回退为自建 1 秒轮询"的回归形态无检出力

- **域**：upstream-touch
- **位置**：`packages/opencode/test/kilocode/cli-shutdown.test.ts`
- **处理状态**：**已修复**

**处理记录**：「未设置 KILO_PARENT_PID 时不停机」测试的等待窗口从 120ms 延长到 1200ms（超过 parent-watchdog 默认轮询间隔 1000ms）：即使修复被回退成忽略 watchdogIntervalMs 参数、固定 1 秒轮询的自建无门控检测，窗口内定时器也必然触发一次并被断言检出，消除假阴性。

**修改文件**：`packages/opencode/test/kilocode/cli-shutdown.test.ts`

**测试**：cd packages/opencode && bun test test/kilocode/cli-shutdown.test.ts → 4 pass / 0 fail

**问题描述**：原测试仅等待 120ms（依赖注入的 10ms 轮询）；若修复被回退为固定 1000ms 轮询的无门控形态，120ms 窗口内定时器未触发，测试依旧通过（假阴性），只能防住「复用 parent-watchdog 但门控被破坏」的形态。

### F75【低/质量】F44 超限分支注释"不会丢失更新"强于实际保证

- **域**：upstream-touch
- **位置**：`packages/opencode/src/config/config.ts`（loadGlobal 稳定性重试）
- **处理状态**：**已修复**（注释修正）

**处理记录**：注释补撕裂快照的极端情形说明：超限采用的最后一次快照可能是加载中途被外部改写的"撕裂"内容，若外部写入恰好在 after stamp 读取之前停止（stamp 与最终文件一致），该快照会被沿用到下一次真实变更为止；触发需要连续 5 轮加载期间持续写入且恰好停在窗口内，实践中概率极低，作为超限兜底的已知取舍接受。实现无错，仅原注释表述偏强。

**修改文件**：`packages/opencode/src/config/config.ts`

**测试**：纯注释；global-config-refresh.test.ts 保持通过

**问题描述**：见处理记录。

---

## 第二轮全量验证记录（2026-07-30，F60-F75 处理完成后）

处理完成后由独立对抗复审逐条核验（16 条全部确认与处理记录一致、无虚报；高风险条目 F65 默认翻转、F68 三项竞态、F62 ensuring、F60 路径判定、F71 正则经对抗推演未发现修复引入的行为缺陷），复审提出的 4 项残余（F68 缺针对性测试、F61 文档数字过时、F71 注释与实现表述出入、F60 缺 `rel === ".."` 边界用例）已全部当轮闭环处理并回填至各条目。

| 检查项 | 结果 |
|---|---|
| kilo-vscode `bun run test:unit`（F61 扩展后，含 connection-service.test.ts） | 3560 通过 / 1 失败——唯一失败为第一轮已记载的 `WorktreeManager.resolveStartPoint` 需真实 git fetch 的既有环境失败，与本批次无关 |
| kilo-vscode `bun run typecheck`（扩展宿主 + webview） | 通过 |
| opencode 修复相关测试（global-lifecycle、cli-shutdown、provider-config-refresh 20 条、model-cache-effect、custom-provider-delete、provider-variant-order、provider-auth-lifecycle、parent-watchdog） | 全部通过 |
| opencode `test/provider/` 全目录（上游 Provider 路径回归） | 428 通过 / 0 失败 |
| opencode `bun x tsc --noEmit` | 通过（0 错误） |
| script `zlfcode/check-release.test.ts`（5 条，含 F71 两个新用例）与 `check-release.ts zlfcode-v7.4.16-v0.03` 实跑 | 通过 |
| `bun run script/check-workflows.ts` | 通过（29 workflows） |
| `bun run script/check-md-table-padding.ts` | 通过 |
| `test/kilocode/server/` 整目录连跑（F69 声明验证） | 83 通过 / 6 失败（预期内，见 F69 处理记录；污染源文件单独运行 3 通过 / 0 失败） |

说明：自动测试不等于完整验收。第二轮中行为有变化的路径需在下次发布前于 Cursor 人工确认：设置页与聊天选择器的标签语义（F65，聊天选择器行为应与修复前一致、设置页继续显示原始配置值）、workspace 内以 `..` 开头命名文件的 mention 附加（F60）、自定义 Provider 模型发现对异常分页端点的终止行为（F64/F70）。
