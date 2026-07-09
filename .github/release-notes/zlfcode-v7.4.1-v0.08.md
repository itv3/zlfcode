# ZLF Code 7.4.1-v0.08

## 主要变更

- 修复 Remote-SSH 环境中提供商设置页、聊天模型选择器和后端状态可能不同步的问题。
- 优化自定义提供商模型发现流程，减少大模型目录 payload 对远端 webview/extension host 的影响。
- 修复自定义提供商保存或删除后可能长时间等待、成功提示与页面状态不同步的问题。
- 加强 CLI 后端生命周期处理，降低 Remote-SSH 下 stale server、孤儿进程和共享状态残留导致的连接异常。
- 打包阶段强制使用真实 CLI binary，避免发布包含 fallback wrapper 的坏包。
- 市场版本更新为 `7.4.108`，发布批次和 VSIX 文件名使用 `7.4.1-v0.08`。
