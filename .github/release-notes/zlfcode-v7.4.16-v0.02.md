# ZLF Code 7.4.16-v0.02

## 主要变更

- 自定义 Provider 选择 `OpenAI Responses` 时，可在 API key 同一行单独启用 WebSocket。
- WebSocket 开关按 Provider 保存并热更新生效，不依赖进程级实验环境变量。
- 带会话亲和标识的流式 `/v1/responses` 请求启用 WebSocket；标题生成、非流式请求和其他 endpoint 保持使用 HTTP。
- WebSocket 连接失败时沿用内置重试与 HTTP 回退策略，Provider 配置更新或实例释放时自动清理连接池。
- 市场版本更新为 `7.4.1602`，发布批次和 VSIX 文件名使用 `7.4.16-v0.02`。
