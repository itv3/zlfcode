# ZLF Code 7.5.5-v0.01

## 主要变更

- 上游基线升级为 Kilo Code `v7.5.5`，重点是**回滚 Bun 1.4 运行时**：上游确认 Bun 1.4 会导致 CLI 终端启动 / PTY 异常，本版本内置 CLI 恢复以 Bun 1.3 构建。若在 7.5.1 版本遇到终端或会话后端启动问题，升级本版本即可修复。
- 安全更新：DOMPurify 升级至 3.4.13、Mermaid 依赖更新（修复 dependabot 告警）。
- Agent Manager 稳定性：GitHub CLI 探测更稳健、减少后台 Git/GitHub 进程开销、恢复被提升会话的元数据。
- ZLF 定制功能全部保持不变。
- 市场版本更新为 `7.5.501`，发布批次和 VSIX 文件名使用 `7.5.5-v0.01`。
