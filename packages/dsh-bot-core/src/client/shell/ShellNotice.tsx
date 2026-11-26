import { useObservable } from "../hooks"
import { IconClose } from "../icons"
import { localeFormat } from "../locale-format"
import type { Observable } from "../observable"
import type { BotsState, RegistrationStatus } from "../session-classification"
import type { Translate } from "../types"
import { Button } from "../ui"
import type { Viewer } from "../viewer"
import type { NoticeDismissal } from "./notice-dismissal"
import { connectionNotice, shellNotice } from "./shell-view"

export type BannerTone = "neutral" | "warning" | "danger"

export function Banner(props: {
  readonly t: Translate
  readonly tone: BannerTone
  readonly role: "alert" | "status"
  readonly marker: `data-dshb-shell-${string}`
  readonly text: string
  readonly dismiss?: { onDismiss(): void; afterDismiss(): void }
  readonly action?: { readonly label: string; onAction(): void }
}) {
  const { t, dismiss, action } = props
  const label = t("error.dismiss")
  return (
    <div
      className="dshb-shell-banner"
      data-tone={props.tone}
      role={props.role}
      {...{ [props.marker]: "" }}
    >
      <span className="dshb-shell-banner-text">{props.text}</span>
      {action !== undefined && (
        <Button
          variant="row"
          onClick={action.onAction}
          marks={{ "data-dshb-shell-banner-action": "" }}
        >
          {action.label}
        </Button>
      )}
      {dismiss !== undefined && (
        <button
          type="button"
          className="dshb-shell-banner-close"
          aria-label={label}
          title={label}
          onClick={() => {
            dismiss.onDismiss()
            dismiss.afterDismiss()
          }}
        >
          <IconClose size={14} />
        </button>
      )}
    </div>
  )
}

export interface ShellNoticeProps {
  readonly t: Translate
  readonly sessionId: string
  readonly viewer: Viewer
  readonly rightbarRegistration: Observable<RegistrationStatus>
  readonly lockdownNotice: NoticeDismissal
  readonly afterDismiss: () => void
}

export function ShellNotice(props: ShellNoticeProps) {
  const { t, sessionId, viewer, afterDismiss } = props
  const view = shellNotice(
    useObservable(props.rightbarRegistration),
    useObservable(props.lockdownNotice),
    useObservable(viewer).notices[sessionId],
  )
  if (view === undefined) return null
  switch (view.kind) {
    case "lockdown":
      return (
        <Banner
          t={t}
          tone="warning"
          role="alert"
          marker="data-dshb-shell-lockdown-failed"
          text={t("notice.lockdownFailed")}
          dismiss={{ onDismiss: props.lockdownNotice.dismiss, afterDismiss }}
        />
      )
    case "viewer":
      return (
        <Banner
          key={view.notice.serial}
          t={t}
          tone="neutral"
          role="status"
          marker="data-dshb-shell-notice"
          text={t(view.notice.key, view.notice.params)}
          dismiss={{ onDismiss: () => viewer.dismiss(sessionId), afterDismiss }}
        />
      )
  }
}

export function BotErrorStatus(props: {
  readonly t: Translate
  readonly error: string
  readonly onDismiss: () => void
  readonly afterDismiss: () => void
}) {
  const { t } = props
  return (
    <Banner
      t={t}
      tone="danger"
      role="alert"
      marker="data-dshb-shell-status"
      text={t("error.generic", { message: props.error })}
      dismiss={{ onDismiss: props.onDismiss, afterDismiss: props.afterDismiss }}
    />
  )
}

export function ConnectionStatus(props: {
  readonly t: Translate
  readonly bots: Observable<BotsState>
}) {
  const { t } = props
  switch (connectionNotice(useObservable(props.bots))) {
    case undefined:
      return null
    case "reconnecting":
      return (
        <Banner
          t={t}
          tone="neutral"
          role="status"
          marker="data-dshb-shell-reconnecting"
          text={t("bots.reconnecting")}
        />
      )
    case "unavailable":
      return (
        <Banner
          t={t}
          tone="danger"
          role="alert"
          marker="data-dshb-shell-unavailable"
          text={t("shell.unavailable")}
        />
      )
  }
}

export function IncidentStatus(props: {
  readonly t: Translate
  readonly count: number | undefined
  review(): void
}) {
  const { t, count } = props
  if (count === undefined) return null
  return (
    <Banner
      t={t}
      tone="danger"
      role="alert"
      marker="data-dshb-shell-incidents"
      text={localeFormat(t).count("incidents.banner", count)}
      action={{ label: t("incidents.review"), onAction: props.review }}
    />
  )
}
