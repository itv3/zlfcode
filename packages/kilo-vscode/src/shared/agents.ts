/**
 * 在 VS Code 扩展的展示/可选列表中隐藏的内置 agent 名单（核心定义仍保留，见 README「维护原则」第 4 条）。
 *
 * 注意：消费方（webview 的 isHiddenAgent、host 端的 filterAgents）只对 native !== false 的
 * agent 应用本名单。在当前后端数据流下，用户自定义的同名 orchestrator 会与内置定义合并、
 * native 恒为 true，因此同样会被隐藏；详见 webview-ui/src/utils/agent-display.ts 中
 * isHiddenAgent 的注释（F52）。
 */
export const HIDDEN_AGENT_NAMES = new Set<string>(["orchestrator"])
