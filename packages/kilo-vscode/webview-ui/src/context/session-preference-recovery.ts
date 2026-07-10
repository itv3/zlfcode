import { batch, createEffect, on, untrack } from "solid-js"
import type { Accessor } from "solid-js"
import type { Message } from "../types/messages"

interface Input {
  ready: Accessor<boolean>
  connected: Accessor<readonly string[]>
  agents: Accessor<readonly { name: string }[]>
  messages: Accessor<Record<string, Message[]>>
  recover: (sessionID: string, messages: Message[], names: Set<string>) => void
}

export function createPreferenceRecovery(input: Input) {
  createEffect(
    on(
      () => [input.ready(), input.connected().join("\0"), input.agents().map((agent) => agent.name).join("\0")] as const,
      ([ready, , value]) => {
        if (!ready) return
        const names = new Set(value ? value.split("\0") : [])
        const entries = untrack(() => Object.entries(input.messages()))
        batch(() => {
          for (const [sid, messages] of entries) input.recover(sid, messages, names)
        })
      },
    ),
  )
}
