import type { ModelSelection } from "../types/messages"

type Deps = {
  current: () => string | undefined
  agent: (session?: string) => string
  selected: (session?: string) => ModelSelection | null
  variant: (session?: string) => string | undefined
  // kilocode_change - ZLF 的 applyModel 返回是否实际应用（不可用模型返回 false 被忽略）
  apply: (agent: string, selection: ModelSelection, session?: string) => boolean | void
  // kilocode_change - ZLF：会话覆盖写入前的模型可用性校验
  valid?: (selection: ModelSelection) => boolean
  set: (session: string, selection: ModelSelection) => void
  carry: (selection: ModelSelection, value: string | undefined, agent: string, session?: string) => void
  hide: (session: string) => void
}

export function createModelSelector(deps: Deps) {
  const select = (providerID: string, modelID: string, sessionID?: string) => {
    const session = sessionID ?? deps.current()
    const agent = deps.agent(session)
    const current = deps.selected(session)
    const value = current ? deps.variant(session) : undefined
    const selection = { providerID, modelID }
    // kilocode_change start - 不可用模型被 applyModel 忽略时，不携带变体也不清理错误提示
    const applied = deps.apply(agent, selection, session)
    if (applied === false) return
    // kilocode_change end
    deps.carry(selection, value, agent, session)
    if (session) deps.hide(session)
  }
  const session = (sessionID: string, providerID: string, modelID: string) => {
    // Session overrides must not mutate the per-mode selection while a new
    // Agent Manager session is still being assigned its agent.
    const agent = deps.agent(sessionID)
    const current = deps.selected(sessionID)
    const value = current ? deps.variant(sessionID) : undefined
    const selection = { providerID, modelID }
    // kilocode_change start - ZLF：不可用模型不写入会话覆盖
    if (deps.valid && !deps.valid(selection)) {
      console.warn("[Kilo New] Ignoring unavailable session model:", selection)
      return
    }
    // kilocode_change end
    deps.set(sessionID, selection)
    deps.carry(selection, value, agent, sessionID)
  }
  return { select, session }
}
