import { useCallback, useId, useRef, useState } from "react"
import type { BotView } from "../shared/bots"
import { type BotDeletion, confirmsDeletion } from "./bot-deletion"
import { useObservable } from "./hooks"
import { type BotsState, snapshotOf } from "./session-classification"
import type { Observable, Translate } from "./types"
import { Button } from "./ui/Button"
import { useLayer } from "./ui/layers"

export interface DeleteBotFace {
  readonly bots: Observable<BotsState>
  readonly deletion: BotDeletion
}

export function DeleteBotDialog({ t, bots, deletion }: DeleteBotFace & { readonly t: Translate }) {
  const botId = useObservable(deletion.asking)
  const bot = snapshotOf(useObservable(bots))?.bots.find((item) => item.id === botId)
  if (bot === undefined) return null
  return <DeleteBotForm key={bot.id} t={t} bot={bot} deletion={deletion} />
}

function DeleteBotForm(props: {
  readonly t: Translate
  readonly bot: BotView
  readonly deletion: BotDeletion
}) {
  const { t, bot, deletion } = props
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const confirmed = confirmsDeletion(typed, bot.name)

  const cancel = useCallback(() => {
    if (!busy) deletion.cancel()
  }, [busy, deletion])
  useLayer(dialogRef, { active: true, trap: true, onEscape: cancel })

  const remove = () => {
    if (!confirmed || busy) return
    setBusy(true)
    void deletion.confirm(bot.id)
  }

  return (
    <div className="dshb-modal-root">
      <div className="dshb-modal-mask" aria-hidden="true" onClick={cancel} />
      <div
        ref={dialogRef}
        className="dshb-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        data-dshb-delete-bot={bot.id}
      >
        <div className="dshb-modal-header">
          <h2 id={`${id}-title`} className="dshb-modal-title">
            {t("settings.delete.title", { name: bot.name })}
          </h2>
        </div>
        <form
          className="dshb-modal-body"
          onSubmit={(event) => {
            event.preventDefault()
            remove()
          }}
        >
          <p className="dshb-confirm-text" id={`${id}-description`}>
            {t("settings.delete.description", { name: bot.name })}
          </p>
          <span className="dshb-ui-field" data-width="fill">
            <input
              className="dshb-ui-field-input"
              aria-label={t("settings.delete.confirmLabel", { name: bot.name })}
              autoComplete="off"
              spellCheck={false}
              placeholder={bot.name}
              value={typed}
              disabled={busy}
              data-dshb-autofocus=""
              data-dshb-delete-bot-name=""
              onChange={(event) => setTyped(event.currentTarget.value)}
            />
          </span>
        </form>
        <div className="dshb-modal-footer">
          <Button variant="secondary" disabled={busy} onClick={cancel}>
            {t("form.cancel")}
          </Button>
          <Button
            variant="primary"
            tone="danger"
            disabled={!confirmed || busy}
            onClick={remove}
            marks={{ "data-dshb-delete-bot-accept": "" }}
          >
            {busy ? t("settings.delete.pending") : t("settings.delete.confirm")}
          </Button>
        </div>
      </div>
    </div>
  )
}
