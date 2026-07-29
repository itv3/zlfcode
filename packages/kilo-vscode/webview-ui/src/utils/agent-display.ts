import type { AgentInfo } from "../types/messages"
import { HIDDEN_AGENT_NAMES } from "../../../src/shared/agents"

const descriptions: Record<string, string> = {
  ask: "agent.description.ask",
  code: "agent.description.code",
  debug: "agent.description.debug",
  explore: "agent.description.explore",
  general: "agent.description.general",
  plan: "agent.description.plan",
}

function native(agent: Pick<AgentInfo, "native">) {
  return agent.native !== false
}

/**
 * 判断某个 agent 是否应在本扩展的可选列表中隐藏（目前仅内置 orchestrator）。
 *
 * 关于 native === false 防御分支的说明（F52）：
 * 本函数与 host 端 filterAgents 都保留了「native === false 的同名自定义 agent 不隐藏」的分支，
 * 但在当前后端数据流下该分支实际不可达——后端合并逻辑
 * （packages/opencode/src/agent/agent.ts）只有在 agents[key] 不存在时才创建 native: false
 * 的新 agent，而内置 orchestrator 已由 KiloAgent.patchAgents
 * （packages/opencode/src/kilocode/agent/index.ts）以 native: true 预先注入，用户通过
 * config.agent 或 agent/*.md 定义的同名 orchestrator 一定与内置定义合并、native 恒为 true。
 * 也就是说：用户无法通过自定义同名 agent 绕开隐藏，其对 orchestrator 的 model/prompt
 * 等自定义配置在本扩展中会随隐藏一起不可见（隐藏 orchestrator 本身即设计意图）。
 * 该分支仅作为向前兼容的防御保留：若未来上游合并语义变化（同名自定义 agent 可携带
 * native: false 下发），自定义 agent 仍能正常显示，不会被误伤。
 */
export function isHiddenAgent(agent: Pick<AgentInfo, "name" | "native"> | string): boolean {
  const name = typeof agent === "string" ? agent : agent.name
  const builtin = typeof agent === "string" ? true : native(agent)
  return builtin && HIDDEN_AGENT_NAMES.has(name)
}

export function agentLabel(agent: AgentInfo): string {
  if (agent.displayName) return agent.displayName
  return agent.name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function agentDescription(agent: AgentInfo, t: (key: string) => string): string | undefined {
  const key = native(agent) ? descriptions[agent.name] : undefined
  return key ? t(key) : agent.description
}
