# ZLF Code 7.5.14-v0.01

## 主要变更

- 上游基线升级为 Kilo Code `v7.5.14`（跨 8 个补丁版本）：CLI 启动进一步提速与索引安全边界收紧、压缩恢复期的会话状态修复、Agent Manager 支持从 PR / 分支新建 Worktree、浏览器反馈附件、旧版迁移向导下线；@hey-api/openapi-ts、minimatch、nanoid 等安全更新。
- 跟随上游的组织（Org）账户体系改造：Kilo Gateway 目录改由后端按登录/组织态过滤，未登录时 kilo 目录不再出现（比旧版仅显示免费模型更干净）；模型选择器显示层维持 ZLF 的免费模型过滤不变。
- ZLF 定制全部保留：自定义提供商增强、默认推理强度全链路、Provider 热刷新与双模式取数（Remote-SSH 性能优化）、WebSocket、不可用模型防护。
- 市场版本更新为 `7.5.1401`，发布批次和 VSIX 文件名使用 `7.5.14-v0.01`。
