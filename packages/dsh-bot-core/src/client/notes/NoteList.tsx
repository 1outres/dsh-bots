import type { BotNotesStatus, NoteHit, NoteType } from "../../shared/notes"
import { useObservable } from "../hooks"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { ErrorText, Group, NavRow, Row, Select, TextInput } from "../ui"
import { shownValue } from "./loader"
import type { NotesModel } from "./model"
import { failureText, TYPE_FILTERS, TypeTag, typeLabel } from "./parts"

type ReadyStatus = Extract<BotNotesStatus, { state: "ready" }>

export interface NoteListProps {
  readonly t: Translate
  readonly model: NotesModel
  readonly status: ReadyStatus
}

function NoteRow({ t, note, open }: { t: Translate; note: NoteHit; open(noteId: string): void }) {
  const meta =
    note.summary === undefined && note.lines.length === 0 ? undefined : (
      <>
        {note.summary !== undefined && (
          <span className="dshb-notes-summary-line">{note.summary}</span>
        )}
        {note.lines.map((line, index) => (
          <span key={index} className="dshb-notes-hit">
            {line}
          </span>
        ))}
      </>
    )
  return (
    <NavRow
      density="compact"
      label={note.title}
      meta={meta}
      trailing={<TypeTag t={t} type={note.type} />}
      onOpen={() => open(note.id)}
      marks={{ "data-dshb-note": note.id }}
    />
  )
}

/** The notes as a list: search, a type, the pinned notes apart while neither is set. */
export function NoteList({ t, model, status }: NoteListProps) {
  const navigation = useObservable(model.navigation)
  const load = useObservable(model.listing)
  const listing = shownValue(load)
  const format = localeFormat(t)
  const filtered = navigation.query.trim() !== "" || navigation.type !== undefined
  const rows = (notes: readonly NoteHit[]) =>
    notes.map((note) => <NoteRow key={note.id} t={t} note={note} open={model.open} />)
  return (
    <>
      <div className="dshb-notes-toolbar">
        <TextInput
          value={navigation.query}
          onChange={model.setQuery}
          label={t("notes.search")}
          placeholder={t("notes.search")}
          marks={{ "data-dshb-notes-search": "" }}
        />
        <Select<"all" | NoteType>
          value={navigation.type ?? "all"}
          choices={TYPE_FILTERS.map((value) => ({
            value,
            label: value === "all" ? t("notes.type.all") : typeLabel(t, value),
          }))}
          onChange={(value) => model.setType(value === "all" ? undefined : value)}
          label={t("notes.type")}
          marks={{ "data-dshb-notes-type": "" }}
        />
      </div>
      {load.status === "failed" && <ErrorText>{failureText(t, load.failure)}</ErrorText>}
      {listing === undefined && load.status !== "failed" && (
        <p className="dshb-panel-note">{t("notes.loading")}</p>
      )}
      {listing !== undefined && filtered && (
        <Group
          title={format.count("notes.results", listing.notes.length)}
          marks={{ "data-dshb-notes-results": "" }}
        >
          {listing.notes.length === 0 ? (
            <Row label={t("notes.none")} density="compact" />
          ) : (
            rows(listing.notes)
          )}
        </Group>
      )}
      {listing !== undefined && !filtered && (
        <>
          {listing.notes.some((note) => note.pinned) && (
            <Group
              title={t("notes.pinned")}
              aside={
                <span className="dshb-notes-usage">
                  {t("notes.pinned.usage", {
                    used: format.number(status.pinned.characters),
                    limit: format.number(status.pinned.limit),
                  })}
                </span>
              }
              marks={{ "data-dshb-notes-pinned": "" }}
            >
              {rows(listing.notes.filter((note) => note.pinned))}
            </Group>
          )}
          {listing.notes.some((note) => !note.pinned) && (
            <Group title={t("notes.all")} marks={{ "data-dshb-notes-all": "" }}>
              {rows(listing.notes.filter((note) => !note.pinned))}
            </Group>
          )}
        </>
      )}
      {status.invalid.length > 0 && (
        <Group title={t("notes.invalid")} marks={{ "data-dshb-notes-invalid": "" }}>
          {status.invalid.map((file) => (
            <Row
              key={file.file}
              density="compact"
              label={file.file}
              meta={file.problem}
              metaTone="danger"
            />
          ))}
        </Group>
      )}
    </>
  )
}
