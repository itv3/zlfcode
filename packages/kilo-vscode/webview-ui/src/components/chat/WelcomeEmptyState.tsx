import { type Component, type JSX, For, Show } from "solid-js"
import { Icon } from "@kilocode/kilo-ui/icon"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { useSession } from "../../context/session"
import { useLanguage } from "../../context/language"
import { recentSessions } from "../../context/session-utils"
import type { SessionInfo } from "../../types/messages"
import { formatRelativeDate } from "../../utils/date"
import { FeedbackDialog } from "./FeedbackDialog"

interface WelcomeEmptyStateProps {
  sessions?: () => SessionInfo[]
  onSelectSession?: (id: string) => void
  onShowHistory?: () => void
  footer?: JSX.Element
}

/**
 * ZLF 静态品牌 logo（ZLF 适配）。上游在此处为 Kilo 方形标志加了悬停旋转 + Lottie
 * 动画（AnimatedKiloLogo），属 Kilo 品牌专属，ZLF 不引入。
 */
export const KiloLogo = () => {
  const icons = (window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI || ""

  // ZLF 适配：ZLF 静态品牌 logo；上游 v7.7.3 的悬停动画（AnimatedKiloLogo）是 Kilo 标志专属，不引入
  return (
    <div class="kilo-logo">
      <img src={`${icons}/zlfcode-logo.svg`} alt="ZLF Code" />
    </div>
  )
}

export const WelcomeEmptyState: Component<WelcomeEmptyStateProps> = (props) => {
  const session = useSession()
  const language = useLanguage()
  const dialog = useDialog()
  const recent = () => recentSessions(props.sessions?.() ?? session.sessions())

  return (
    <div class="message-list-empty">
      <KiloLogo />
      <p class="kilo-about-text">{language.t("session.messages.welcome")}</p>
      <Show when={recent().length > 0 && props.onSelectSession}>
        <div class="recent-sessions">
          <span class="recent-sessions-label">{language.t("session.recent")}</span>
          <For each={recent()}>
            {(item) => (
              <button class="recent-session-item" onClick={() => props.onSelectSession?.(item.id)}>
                <span class="recent-session-title" dir="auto">
                  {item.title || language.t("session.untitled")}
                </span>
                <span class="recent-session-date">{formatRelativeDate(item.updatedAt)}</span>
              </button>
            )}
          </For>
          <Show when={props.onShowHistory}>
            <button class="show-history-btn" onClick={() => props.onShowHistory?.()}>
              <Icon name="history" size="small" />
              {language.t("session.showHistory")}
            </button>
          </Show>
        </div>
      </Show>
      <button class="feedback-button" onClick={() => dialog.show(() => <FeedbackDialog />)}>
        <Icon name="bubble-5" size="small" />
        {language.t("feedback.button")}
      </button>
      {props.footer}
    </div>
  )
}
