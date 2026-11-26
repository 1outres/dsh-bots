import { useCallback, useId, useRef, useState } from "react"
import { useObservable } from "./hooks"
import { localeFormat, type PluralKey } from "./locale-format"
import type { ArchiveConfirmRequest, SessionArchive } from "./session-archive"
import { sessionKey } from "./tree"
import type { SessionActivity, Translate } from "./types"
import { Button } from "./ui/Button"
import { ErrorText } from "./ui/EmptyState"
import { useLayer } from "./ui/layers"

export interface ArchiveConfirmProps {
  readonly t: Translate
  readonly archive: Pick<SessionArchive, "confirming" | "stopAndArchive" | "settle">
}

export function ArchiveConfirmDialog({ t, archive }: ArchiveConfirmProps) {
  const request = useObservable(archive.confirming)
  if (request === null) return null
  return (
    <ArchiveConfirmForm key={request.session.sessionId} t={t} request={request} archive={archive} />
  )
}

const FAMILIES: Readonly<Record<string, PluralKey>> = {
  subagent: "archive.confirm.subagents",
  job: "archive.confirm.jobs",
  schedule: "archive.confirm.schedules",
}

export function activityLine(entry: SessionActivity, t: Translate): string {
  if (entry.kind === "turn") return t("archive.confirm.turn")
  const items = entry.items ?? []
  const names = items.map((item) => item.label ?? item.id).join(t("archive.confirm.separator"))
  const family = FAMILIES[entry.kind]
  const format = localeFormat(t)
  if (family === undefined) {
    return format.count("archive.confirm.other", items.length, { kind: entry.kind })
  }
  return format.count(family, items.length, { names })
}

function ArchiveConfirmForm(props: {
  readonly t: Translate
  readonly request: ArchiveConfirmRequest
  readonly archive: ArchiveConfirmProps["archive"]
}) {
  const { t, request, archive } = props
  const { session } = request
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const dialogRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback(() => {
    if (!busy) archive.settle()
  }, [archive, busy])
  useLayer(dialogRef, {
    active: true,
    trap: true,
    onEscape: close,
    restore: () =>
      document.querySelector<HTMLElement>(
        `[data-dshb-key="${CSS.escape(sessionKey(session.sessionId))}"]`,
      ),
  })

  const confirm = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await archive.stopAndArchive(request)
    } catch (cause) {
      setBusy(false)
      setError(
        t("error.generic", { message: cause instanceof Error ? cause.message : String(cause) }),
      )
    }
  }

  return (
    <div className="dshb-modal-root">
      <div className="dshb-modal-mask" aria-hidden="true" onClick={close} />
      <div
        ref={dialogRef}
        className="dshb-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        data-dshb-archive-confirm=""
      >
        <div className="dshb-modal-header">
          <h2 id={`${id}-title`} className="dshb-modal-title">
            {t("archive.confirm.title")}
          </h2>
        </div>
        <div className="dshb-modal-body">
          <p className="dshb-confirm-text" id={`${id}-description`}>
            {t("archive.confirm.description", { title: session.title })}
          </p>
          <ul className="dshb-activity" aria-label={t("archive.confirm.activity")}>
            {request.activity.map((entry, index) => (
              <li key={`${entry.kind}-${String(index)}`}>{activityLine(entry, t)}</li>
            ))}
          </ul>
          {error !== undefined && <ErrorText>{error}</ErrorText>}
        </div>
        <div className="dshb-modal-footer">
          <Button variant="secondary" autoFocus disabled={busy} onClick={close}>
            {t("form.cancel")}
          </Button>
          <Button
            variant="primary"
            tone="danger"
            disabled={busy}
            onClick={() => void confirm()}
            marks={{ "data-dshb-archive-confirm-accept": "" }}
          >
            {busy ? t("archive.confirm.pending") : t("archive.confirm.action")}
          </Button>
        </div>
      </div>
    </div>
  )
}
