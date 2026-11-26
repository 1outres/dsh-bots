import { type ReactNode, useEffect } from "react"
import { useObservable } from "./hooks"
import type { MessageKey } from "./i18n"
import { IconAlert, IconCheck } from "./icons"
import { type BotNotice, NOTICE_MS, type NoticeStore, type NoticeTone, noticeTone } from "./notices"
import type { Translate } from "./types"

export { NOTICE_MS } from "./notices"

const TEXT: { readonly [Kind in BotNotice["kind"]]: MessageKey } = {
  created: "toast.created",
  "create-failed": "toast.createFailed",
  "remove-failed": "toast.removeFailed",
  "session-archived": "toast.sessionArchived",
  "archived-not-openable": "session.archived.hint",
  "main-started": "toast.mainStarted",
  "main-unchanged": "toast.mainUnchanged",
}

const ICON: { readonly [Tone in NoticeTone]: ReactNode } = {
  success: <IconCheck size={16} />,
  info: null,
  warning: <IconAlert size={16} />,
  error: <IconAlert size={16} />,
}

export interface NoticeActions {
  undoArchive(botId: string, sessionId: string): void
  showArchived(botId: string): void
}

export interface NoticeToastProps {
  readonly t: Translate
  readonly notices: NoticeStore
  readonly actions: NoticeActions
}

const paramsOf = (notice: BotNotice) => ("name" in notice ? { name: notice.name } : undefined)

export function BotNoticeToast({ t, notices, actions }: NoticeToastProps) {
  const shown = useObservable(notices)
  const seq = shown?.seq
  useEffect(() => {
    if (seq === undefined) return
    const timer = setTimeout(() => notices.dismiss(seq), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notices, seq])
  if (shown === null) return null
  const { notice } = shown
  const tone = noticeTone(notice)
  const dismiss = () => notices.dismiss(shown.seq)
  const icon = ICON[tone]
  return (
    <div
      key={shown.seq}
      className="dshb-toast"
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      data-tone={tone}
      data-dshb-notice={notice.kind}
    >
      {icon !== null && <span className="dshb-toast-icon">{icon}</span>}
      <span className="dshb-toast-text">
        {t(TEXT[notice.kind], paramsOf(notice))}
        {notice.kind === "session-archived" && (
          <>
            <button
              type="button"
              className="dshb-toast-action"
              data-dshb-notice-action="undo"
              onClick={() => {
                actions.undoArchive(notice.botId, notice.sessionId)
                dismiss()
              }}
            >
              {t("toast.undo")}
            </button>
            <button
              type="button"
              className="dshb-toast-action"
              data-dshb-notice-action="show-archived"
              onClick={() => {
                actions.showArchived(notice.botId)
                dismiss()
              }}
            >
              {t("toast.showArchived")}
            </button>
          </>
        )}
      </span>
    </div>
  )
}
