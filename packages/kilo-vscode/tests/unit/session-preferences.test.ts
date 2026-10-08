import { describe, expect, it } from "bun:test"
import { recoverModel, resolveInfoPrefs, resolveMessagePrefs } from "../../webview-ui/src/context/session-preferences"
import { createSessionRecovery } from "../../webview-ui/src/context/session-recovery"
import type { Message, ModelSelection } from "../../webview-ui/src/types/messages"

function msg(input: Partial<Message>): Message {
  return {
    id: input.id ?? "msg",
    sessionID: input.sessionID ?? "session-a",
    role: input.role ?? "user",
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    ...input,
  }
}

const agents = new Set(["code", "ask"])

describe("session preference recovery", () => {
  it("recovers each agent's latest user message", () => {
    const prefs = resolveMessagePrefs(
      [
        msg({
          id: "old",
          agent: "ask",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "low" },
        }),
        msg({
          id: "new",
          agent: "code",
          model: { providerID: "openai", modelID: "gpt-5.5", variant: "medium" },
        }),
      ],
      agents,
    )

    expect(prefs.agent).toBe("code")
    expect(prefs.picks).toEqual({
      ask: { model: { providerID: "anthropic", modelID: "claude-sonnet-4" }, variant: "low", seq: 1 },
      code: { model: { providerID: "openai", modelID: "gpt-5.5" }, variant: "medium", seq: 0 },
    })
  })

  it.each([undefined, ""])("restores model default %s instead of an older effort", (variant) => {
    const prefs = resolveMessagePrefs(
      [
        msg({ agent: "code", model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" } }),
        msg({ agent: "code", model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant } }),
      ],
      agents,
    )

    expect(prefs.picks.code?.variant).toBe("")
  })

  it("ignores assistant-only model data and invalid agents", () => {
    const prefs = resolveMessagePrefs(
      [
        msg({
          role: "assistant",
          agent: "task",
          model: { providerID: "openai", modelID: "gpt-5.5", variant: "high" },
        }),
      ],
      agents,
    )

    expect(prefs.agent).toBeUndefined()
    expect(prefs.picks).toEqual({})
    expect(prefs.unattributed).toBeUndefined()
  })

  it("keeps agentless user messages for the session's current agent", () => {
    const prefs = resolveMessagePrefs(
      [msg({ model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" } })],
      agents,
    )

    expect(prefs.unattributed).toEqual({
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      variant: "high",
      seq: 0,
    })
  })

  it("can recover the latest valid agent separately from the latest user model", () => {
    const prefs = resolveMessagePrefs(
      [
        msg({ agent: "ask", model: { providerID: "anthropic", modelID: "claude-sonnet-4" } }),
        msg({ role: "assistant", agent: "code" }),
      ],
      agents,
    )

    expect(prefs.agent).toBe("code")
    expect(prefs.picks).toEqual({
      ask: { model: { providerID: "anthropic", modelID: "claude-sonnet-4" }, variant: "", seq: 1 },
    })
  })

  it("prefers the newer agentless message over an older attributed one", () => {
    const prefs = resolveMessagePrefs(
      [
        msg({ agent: "code", model: { providerID: "openai", modelID: "gpt-5.5" } }),
        msg({ model: { providerID: "anthropic", modelID: "claude-sonnet-4", variant: "high" } }),
      ],
      agents,
    )

    expect(prefs.agent).toBe("code")
    expect(prefs.picks.code?.seq).toBe(1)
    expect(prefs.unattributed?.seq).toBe(0)
  })
})

describe("session info recovery", () => {
  it("recovers the agent, model and effort a server session last ran with", () => {
    expect(
      resolveInfoPrefs({ agent: "ask", model: { providerID: "openai", modelID: "gpt-5.5", variant: "high" } }, agents),
    ).toEqual({ agent: "ask", model: { providerID: "openai", modelID: "gpt-5.5" }, variant: "high" })
  })

  it("treats a missing variant as an explicit Default", () => {
    expect(resolveInfoPrefs({ agent: "code", model: { providerID: "openai", modelID: "gpt-5.5" } }, agents)).toEqual({
      agent: "code",
      model: { providerID: "openai", modelID: "gpt-5.5" },
      variant: "",
    })
  })

  it("keeps the agent alone when the session has no model yet", () => {
    expect(resolveInfoPrefs({ agent: "code" }, agents)).toEqual({ agent: "code" })
  })

  it("ignores unknown or missing agents so a model is never attributed to the wrong agent", () => {
    const model = { providerID: "openai", modelID: "gpt-5.5" }
    expect(resolveInfoPrefs({ agent: "task", model }, agents)).toBeUndefined()
    expect(resolveInfoPrefs({ model }, agents)).toBeUndefined()
  })
})

describe("ZLF 历史模型可用性校验", () => {
  it("提供商目录未加载时暂缓恢复模型", () => {
    const model = { providerID: "12", modelID: "gpt-5.5" }
    expect(recoverModel(model, false, () => true)).toBeUndefined()
  })

  it("已删除提供商的模型不会重新写入会话", () => {
    const model = { providerID: "sg", modelID: "gpt-5.5" }
    expect(recoverModel(model, true, (selection) => selection.providerID === "12")).toBeUndefined()
  })

  it("目录加载后恢复仍有效的模型", () => {
    const model = { providerID: "12", modelID: "gpt-5.5" }
    expect(recoverModel(model, true, (selection) => selection.providerID === "12")).toEqual(model)
  })
})

describe("ZLF 会话历史恢复与上游按模式选择的兼容", () => {
  it("目录就绪后恢复各模式的有效模型，并保留用户已选的模式", () => {
    const store = {
      agentSelections: {} as Record<string, string>,
      sessionOverrides: {} as Record<string, Record<string, ModelSelection>>,
      variantSelections: {} as Record<string, string>,
    }
    const valid = new Set<string>()
    const recovery = createSessionRecovery({
      store,
      select: (id, agent) => {
        store.agentSelections[id] = agent
      },
      pick: (id, agent, model) => {
        store.sessionOverrides[id] = { ...store.sessionOverrides[id], [agent]: model }
      },
      variant: (key, value) => {
        store.variantSelections[key] = value
      },
      agent: (id) => store.agentSelections[id] ?? "code",
      names: () => agents,
      valid: (model) => valid.has(model.providerID),
    })
    const list = [
      msg({ agent: "ask", model: { providerID: "anthropic", modelID: "claude", variant: "high" } }),
      msg({ agent: "code", model: { providerID: "openai", modelID: "gpt", variant: "low" } }),
    ]
    recovery.messages("session-a", list)
    expect(store.sessionOverrides).toEqual({})
    expect(store.variantSelections).toEqual({})

    valid.add("anthropic")
    valid.add("openai")
    store.sessionOverrides["session-a"] = { code: { providerID: "openai", modelID: "manual" } }
    recovery.messages("session-a", list)
    expect(store.sessionOverrides["session-a"]).toEqual({
      code: { providerID: "openai", modelID: "manual" },
      ask: { providerID: "anthropic", modelID: "claude" },
    })
    expect(store.variantSelections["session/session-a/anthropic/claude"]).toBe("high")
  })
})
