import { type KeyboardEvent, useEffect, useRef } from "react"
import { useObservable } from "../hooks"
import { IconArrowLeft, IconNotes, IconRefresh } from "../icons"
import { SidePanelFrame } from "../shell/SidePanelFrame"
import type { Translate } from "../types"
import { EmptyState, ErrorText, Segmented } from "../ui"
import type { NotesFace } from "./face"
import { shownValue } from "./loader"
import type { NotesModel, NotesTab } from "./model"
import { NoteCalendar } from "./NoteCalendar"
import { NoteList } from "./NoteList"
import { NotePage } from "./NotePage"

export interface NotesPanelProps {
  readonly t: Translate
  readonly sessionId: string
  readonly face: NotesFace
  readonly containerRef: { readonly current: HTMLElement | null }
  close(): void
}

export function NotesPanel(props: NotesPanelProps) {
  const { t, face } = props
  const model = face.modelOf(props.sessionId)
  useEffect(() => model.attach(), [model])
  const navigation = useObservable(model.navigation)
  const shown = shownValue(useObservable(model.document))
  const heading = useRef<HTMLHeadingElement>(null)
  const noteId = navigation.trail.at(-1)
  const depth = navigation.trail.length
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [depth, noteId])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    props.close()
  }
  const title =
    noteId !== undefined && shown?.note.id === noteId ? shown.note.title : t("notes.title")
  return (
    <SidePanelFrame
      label={t("notes.panel")}
      title={title}
      titleRef={heading}
      leading={
        noteId !== undefined && (
          <button
            type="button"
            className="dshb-shell-button"
            aria-label={t("notes.back")}
            title={t("notes.back")}
            onClick={model.back}
            data-dshb-notes-back=""
          >
            <IconArrowLeft size={16} />
          </button>
        )
      }
      trailing={
        <button
          type="button"
          className="dshb-shell-button"
          aria-label={t("notes.refresh")}
          title={t("notes.refresh")}
          onClick={model.refresh}
        >
          <IconRefresh size={16} />
        </button>
      }
      closeLabel={t("notes.close")}
      resizeLabel={t("notes.resize")}
      onClose={props.close}
      width={face.width}
      containerRef={props.containerRef}
      onKeyDown={onKeyDown}
      marks={{ "data-dshb-notes": "" }}
    >
      <div className="dshb-notes-body">
        <NotesContent t={t} model={model} />
      </div>
    </SidePanelFrame>
  )
}

export function NotesContent({ t, model }: { readonly t: Translate; readonly model: NotesModel }) {
  const feed = useObservable(model.status)
  const navigation = useObservable(model.navigation)
  if (feed.status === "loading") return <p className="dshb-panel-note">{t("notes.loading")}</p>
  if (feed.status === "failed")
    return <ErrorText>{t("notes.failed", { message: feed.message })}</ErrorText>
  const status = feed.value
  if (status.state === "unavailable") {
    return (
      <EmptyState
        icon={<IconNotes size={28} />}
        title={t("notes.unavailable")}
        detail={status.message}
        marks={{ "data-dshb-notes-unavailable": "" }}
      />
    )
  }
  if (status.state === "loading") return <p className="dshb-panel-note">{t("notes.loading")}</p>
  if (navigation.trail.length > 0) return <NotePage t={t} model={model} />
  if (status.count === 0 && status.invalid.length === 0) {
    return (
      <EmptyState
        icon={<IconNotes size={28} />}
        title={t("notes.empty")}
        marks={{ "data-dshb-notes-empty": "" }}
      />
    )
  }
  return (
    <>
      <Segmented<NotesTab>
        value={navigation.tab}
        choices={[
          { value: "list", label: t("notes.view.list") },
          { value: "calendar", label: t("notes.view.calendar") },
        ]}
        onChange={model.setTab}
        label={t("notes.view")}
        marks={{ "data-dshb-notes-tab": "" }}
      />
      {navigation.tab === "list" ? (
        <NoteList t={t} model={model} status={status} />
      ) : (
        <NoteCalendar t={t} model={model} />
      )}
    </>
  )
}
