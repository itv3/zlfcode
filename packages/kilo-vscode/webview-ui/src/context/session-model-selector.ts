import type { ModelSelection } from "../types/messages"

type Deps = {
  current: () => string
  agent: (session?: string) => string
  selected: (session?: string) => ModelSelection | null
  variant: (session?: string) => string | undefined
  // ZLF 适配：ZLF 的 applyModel 返回是否实际应用（不可用模型返回 false 被忽略）
  apply: (agent: string, selection: ModelSelection, session: string) => boolean | void
  // ZLF 适配：ZLF：会话覆盖写入前的模型可用性校验
  valid?: (selection: ModelSelection) => boolean
  set: (session: string, agent: string, selection: ModelSelection) => void
  carry: (selection: ModelSelection, value: string | undefined, agent: string, session?: string) => void
  hide: (session: string) => void
}

export function createModelSelector(deps: Deps) {
  const select = (providerID: string, modelID: string, sessionID?: string) => {
    const session = sessionID ?? deps.current()
    const agent = deps.agent(session)
    const value = deps.variant(session)
    const selection = { providerID, modelID }
    // ZLF 适配开始 - 不可用模型被 applyModel 忽略时，不携带变体也不清理错误提示
    const applied = deps.apply(agent, selection, session)
    if (applied === false) return
    // ZLF 适配结束
    deps.carry(selection, value, agent, session)
    if (session) deps.hide(session)
  }

  const session = (sessionID: string, providerID: string, modelID: string) => {
    const agent = deps.agent(sessionID)
    const value = deps.variant(sessionID)
    const selection = { providerID, modelID }
    // ZLF 适配开始 - ZLF：不可用模型不写入会话覆盖
    if (deps.valid && !deps.valid(selection)) {
      console.warn("[Kilo New] Ignoring unavailable session model:", selection)
      return
    }
    // ZLF 适配结束
    deps.set(sessionID, agent, selection)
    deps.carry(selection, value, agent, sessionID)
  }

  return { select, session }
}
