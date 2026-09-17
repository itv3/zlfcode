# ZLF Code 7.7.2-v0.01

## 主要变更

- 上游基线升级为 Kilo Code `v7.7.2`：Agent Manager 新增 worktree 预热池，CLI 新增定时唤醒与取消工具。
- 上下文工作流增强：支持将 session、worktree、terminal 和文档拖入提示词，并以「Add to Context」卡片展示选中的上下文。
- PR 评审增强：可从差异视图向 GitHub Pull Request 发布内联评论，并支持复制 PR 评论链接。
- 推理显示新增 `Expanded`、`Preview` 和 `Headline` 三种模式，子代理推理也遵循同一显示设置。
- 配置与集成增强：Marketplace 的发现与安装迁移到后端 API；Provider 断开后可重新设置 API key；语音输入支持自定义转写服务。
- 稳定性与性能优化：同一轮连续三次出现 malformed tool call 后自动熔断，避免无限重试；本地 recall 搜索获得索引、性能和相关性改进。
- 聊天体验更稳定：修复流式输出期间的文本选择和滚动跳动，稳定任务卡片与任务标题状态，并新增消息时间戳提示。
- 共享 agent board 从 `experimental.shared_agent_board` 迁移为顶层 `shared_agent_board` 配置并默认启用。
- ZLF 定制全部保留：自定义提供商增强、默认推理强度全链路、Provider 热刷新与双模式取数、WebSocket、不可用模型防护和后端自动恢复退避。
- 市场版本更新为 `7.7.201`，发布批次和 VSIX 文件名使用 `7.7.2-v0.01`。
