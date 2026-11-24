import { useMemo } from "react"
import type { NoteDocument } from "../../shared/notes"
import { InlineMarkdown, MarkdownView } from "../files/MarkdownView"
import { useObservable } from "../hooks"
import { parseInline } from "../markdown"
import type { Translate } from "../types"
import { ErrorText, Group, NavRow, Row, Tag } from "../ui"
import { shownValue } from "./loader"
import type { NotesModel } from "./model"
import { failureText, linkButtons, linkText, TypeTag } from "./parts"

/** One note: its type, aliases and summary, its body with links by title, then Links and Backlinks. */
export function NotePage({ t, model }: { readonly t: Translate; readonly model: NotesModel }) {
  const load = useObservable(model.document)
  const shown = shownValue(load)
  if (load.status === "failed") return <ErrorText>{failureText(t, load.failure)}</ErrorText>
  if (shown === undefined) return <p className="dshb-panel-note">{t("notes.loading")}</p>
  return <NoteView t={t} document={shown} open={model.open} />
}

function NoteView(props: {
  readonly t: Translate
  readonly document: NoteDocument
  open(noteId: string): void
}) {
  const { t, open } = props
  const shown = props.document
  const { note, targets } = shown
  const buttons = useMemo(() => linkButtons(t, targets, open), [t, targets, open])
  const words = useMemo(() => linkText(t, targets), [t, targets])
  return (
    <article className="dshb-notes-note" data-dshb-note-page={note.id}>
      <div className="dshb-notes-head">
        <div className="dshb-notes-tags">
          <TypeTag t={t} type={note.type} />
          {note.pinned && <Tag marks={{ "data-dshb-note-pinned": "" }}>{t("notes.pinned")}</Tag>}
        </div>
        {note.aliases.length > 0 && (
          <p className="dshb-notes-aliases">
            {t("notes.aliases", { aliases: note.aliases.join(", ") })}
          </p>
        )}
        {note.summary !== undefined && <p className="dshb-notes-summary">{note.summary}</p>}
      </div>
      <div className="dshb-files-markdown dshb-notes-text" data-dshb-note-body="">
        {shown.body.trim() === "" ? (
          <p className="dshb-panel-note">{t("notes.noText")}</p>
        ) : (
          <MarkdownView source={shown.body} noteLink={buttons} />
        )}
      </div>
      <Group title={t("notes.links")} marks={{ "data-dshb-note-links": "" }}>
        {shown.links.length === 0 && <Row density="compact" label={t("notes.links.none")} />}
        {shown.links.map((link) =>
          link.kind === "missing" ? (
            <Row
              key={link.id}
              density="compact"
              label={t("notes.missing")}
              meta={t("notes.missing.title")}
              metaTone="danger"
              marks={{ "data-dshb-note-missing": link.id }}
            />
          ) : (
            <NavRow
              key={link.note.id}
              density="compact"
              label={link.note.title}
              meta={link.note.summary}
              trailing={<TypeTag t={t} type={link.note.type} />}
              onOpen={() => open(link.note.id)}
              marks={{ "data-dshb-note": link.note.id }}
            />
          ),
        )}
      </Group>
      <Group title={t("notes.backlinks")} marks={{ "data-dshb-note-backlinks": "" }}>
        {shown.backlinks.length === 0 && (
          <Row density="compact" label={t("notes.backlinks.none")} />
        )}
        {shown.backlinks.map((link, index) => (
          <NavRow
            key={`${link.from.id}:${index}`}
            density="compact"
            label={link.from.title}
            meta={
              <InlineMarkdown
                content={parseInline(link.line, { noteLinks: true })}
                noteLink={words}
              />
            }
            trailing={<TypeTag t={t} type={link.from.type} />}
            onOpen={() => open(link.from.id)}
            marks={{ "data-dshb-note": link.from.id }}
          />
        ))}
      </Group>
    </article>
  )
}
