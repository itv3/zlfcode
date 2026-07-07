# ZLF Code

这是面向内部使用的 AI coding agent，基于上游 Kilo Code 的非官方 fork 定制。本轮升级采用干净底座重建方式：以官方 `v7.4.1` 为基础，只移植 ZLF 自定义功能文件、发布身份文件、workflow、README 和版本号补丁。

## 版本说明

- 上游版本：`7.4.1`
- ZLF 自定义版本：`v0.03`
- 发布批次：`7.4.1-v0.03`
- 市场版本：`7.4.103`

VS Marketplace / Open VSX 的 `package.json.version` 必须是普通 SemVer，所以市场页面显示 `7.4.103`。GitHub tag、GitHub Release 和 VSIX 文件名使用发布批次 `7.4.1-v0.03`。

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

### 模型列表过滤、排序与选择体验

| 功能 | 说明 |
|---|---|
| 模型列表过滤与排序 | 默认仅显示 Kilo Gateway 免费模型以及用户已添加或已连接提供商的模型，用户 provider 排在免费模型前面。 |
| 模型选择器交互 | 模型选择器默认折叠详情页，单击模型即可直接切换。 |
| 默认收藏 | 首次没有收藏记录时默认收藏 StepFun Step 3.7 Flash 免费模型，用户取消后不会自动恢复。 |

### 智能体中文化与隐藏 orchestrator

| 功能 | 说明 |
|---|---|
| 内置智能体中文说明 | 在设置页“智能体行为 > 代理”和聊天窗口智能体选择器中，`ask` / `code` / `debug` / `explore` / `general` / `plan` 显示中文说明。 |
| 隐藏 `orchestrator` | 在 VS Code 扩展的可选列表中隐藏内置 `orchestrator`；核心定义仍保留。 |

## 本轮升级要点

`7.4.1-v0.03` 保留官方 `v7.4.1` 的 sandbox、Agent Manager、模型选择器虚拟列表、可访问性和 upstream 修复，只重新嵌入 ZLF 三组功能：

- 自定义 provider 的 OpenAI / Anthropic / Gemini 协议、模型发现、默认参数匹配、候选预览和保存字段。
- 模型列表可见性过滤、用户 provider 优先、默认折叠和默认收藏。
- 内置智能体中文展示与 `orchestrator` 隐藏。

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

## 发布

自动发布 workflow：`.github/workflows/publish-zlfcode.yml`

推送 `zlfcode-v*` tag 后自动发布到：

- Open VSX：`https://open-vsx.org/extension/itv3/zlfcode`
- GitHub Release：`https://github.com/itv3/zlfcode/releases`

标准发布目标平台：`darwin-arm64`、`darwin-x64`、`win32-x64`、`win32-arm64`、`linux-x64`、`linux-arm64`。

```bash
git tag zlfcode-v7.4.1-v0.03
git push custom zlfcode-v7.4.1-v0.03
```

发布前必须准备 `.github/release-notes/zlfcode-v7.4.1-v0.03.md`，并确认根 `package.json.version` 与 `packages/kilo-vscode/package.json.version` 都是 `7.4.103`。

## 关系说明

ZLF Code 是非官方自定义版本，不隶属于 Kilo Code，也不由 Kilo Code 官方维护或背书。

## 反馈

如果是上游 Kilo Code 本身的源码问题，请向上游反馈。如果是 ZLF 自定义提供商增强相关问题，请在本仓库反馈。
