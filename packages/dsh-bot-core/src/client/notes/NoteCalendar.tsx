import { useObservable } from "../hooks"
import { IconChevronLeft, IconChevronRight } from "../icons"
import { localeFormat } from "../locale-format"
import type { Translate } from "../types"
import { Button, ErrorText } from "../ui"
import { monthGrid, shiftMonth } from "./calendar"
import { shownValue } from "./loader"
import type { NotesModel } from "./model"
import { failureText } from "./parts"

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const

export function NoteCalendar({ t, model }: { readonly t: Translate; readonly model: NotesModel }) {
  const navigation = useObservable(model.navigation)
  const load = useObservable(model.month)
  const value = shownValue(load)
  const format = localeFormat(t)
  const shown = navigation.month ?? value?.month
  if (load.status === "failed") return <ErrorText>{failureText(t, load.failure)}</ErrorText>
  if (shown === undefined) return <p className="dshb-panel-note">{t("notes.loading")}</p>
  const days = new Map(
    value !== undefined && value.month === shown ? value.days.map((day) => [day.date, day.id]) : [],
  )
  const today = value?.today
  return (
    <div className="dshb-notes-calendar" data-dshb-notes-calendar={shown}>
      <div className="dshb-notes-calendar-head">
        <Button
          variant="icon"
          label={t("notes.calendar.previous")}
          onClick={() => model.showMonth(shiftMonth(shown, -1))}
        >
          <IconChevronLeft size={16} />
        </Button>
        <h4 className="dshb-notes-month" aria-live="polite">
          {format.month(shown)}
        </h4>
        <Button
          variant="icon"
          label={t("notes.calendar.next")}
          onClick={() => model.showMonth(shiftMonth(shown, 1))}
        >
          <IconChevronRight size={16} />
        </Button>
        <Button
          variant="row"
          disabled={today === undefined || today.slice(0, 7) === shown}
          onClick={() => model.showMonth(undefined)}
        >
          {t("notes.calendar.today")}
        </Button>
      </div>
      <table className="dshb-notes-grid">
        <thead>
          <tr>
            {WEEKDAYS.map((index) => (
              <th key={index} scope="col">
                {format.weekday(index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(shown).map((week) => (
            <tr key={week.find((day) => day !== null) ?? ""}>
              {week.map((date, index) => {
                if (date === null) return <td key={`pad-${index}`} />
                const noteId = days.get(date)
                const label = String(Number(date.slice(8)))
                const marks = { "data-today": date === today ? "" : undefined }
                return (
                  <td key={date}>
                    {noteId === undefined ? (
                      <span className="dshb-notes-day" {...marks}>
                        {label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="dshb-notes-day"
                        data-note=""
                        data-dshb-notes-day={date}
                        aria-label={format.day(date)}
                        title={format.day(date)}
                        onClick={() => model.open(noteId)}
                        {...marks}
                      >
                        {label}
                      </button>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
