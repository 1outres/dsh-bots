import { useId, useRef, useState } from "react"
import type { ReleaseNote } from "../../shared/release-notes"
import { MarkdownView } from "../files/MarkdownView"
import type { Translate } from "../types"
import { Button, ErrorText } from "../ui"
import { useLayer } from "../ui/layers"
import type { OnboardingClient } from "./client"

export function ReleaseNotesDialog(props: {
  readonly t: Translate
  readonly notes: readonly ReleaseNote[]
  readonly onboarding: Pick<OnboardingClient, "acknowledgeReleaseNotes">
}) {
  const { t, notes } = props
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  const [state, setState] = useState<{ readonly busy: boolean; readonly error?: string }>({
    busy: false,
  })
  useLayer(ref, { active: true, trap: true, onEscape: () => {} })
  const newest = notes[0]
  const acknowledge = async () => {
    if (newest === undefined) return
    setState({ busy: true })
    try {
      await props.onboarding.acknowledgeReleaseNotes(newest.version)
    } catch (cause) {
      setState({ busy: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  return (
    <div className="dshb-modal-root" data-dshb-release-notes="">
      <div className="dshb-modal-mask" aria-hidden="true" />
      <div
        ref={ref}
        className="dshb-modal dshb-release"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <div className="dshb-release-banner" aria-hidden="true">
          <span className="dshb-release-glow">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M12 3q0 9 9 9q-9 0-9 9q0-9-9-9q9 0 9-9z" />
            </svg>
          </span>
        </div>
        <div className="dshb-modal-header">
          <h2 id={`${id}-title`} className="dshb-modal-title">
            {t("release.title")}
          </h2>
        </div>
        <div className="dshb-modal-body dshb-release-body">
          {notes.map((note) => (
            <section
              key={note.version}
              className="dshb-release-note"
              data-dshb-release-version={note.version}
              lang="en"
            >
              <h3 className="dshb-release-version">
                <a href={note.url} target="_blank" rel="noopener noreferrer">
                  {t("release.version", { version: note.version })}
                </a>
              </h3>
              <div className="dshb-release-markdown">
                <MarkdownView source={note.body} />
              </div>
            </section>
          ))}
          {state.error !== undefined && (
            <ErrorText>{t("error.generic", { message: state.error })}</ErrorText>
          )}
        </div>
        <div className="dshb-modal-footer">
          <Button
            variant="primary"
            autoFocus
            disabled={state.busy}
            onClick={() => void acknowledge()}
            marks={{ "data-dshb-release-ok": "" }}
          >
            {t("release.ok")}
          </Button>
        </div>
      </div>
    </div>
  )
}
