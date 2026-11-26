import { useCallback, useId, useRef, useState } from "react"
import type { BotChannelText } from "../shared/channels"
import { BotCreationFields } from "./creation/BotCreationFields"
import type { BotCreationRequest } from "./creation/request"
import { type CreationSources, useBotCreationForm } from "./creation/use-creation-form"
import type { BotsFace } from "./face"
import { useObservable } from "./hooks"
import { IconClose } from "./icons"
import type { Translate } from "./types"
import { Button } from "./ui/Button"
import { useLayer } from "./ui/layers"

export interface CreateBotFace
  extends Pick<BotsFace, "createBot" | "createDialog">,
    CreationSources {
  text(text: BotChannelText): string
}

interface CreateDialogProps extends CreateBotFace {
  t: Translate
}

export function CreateBotDialog({
  t,
  createBot,
  createDialog,
  creationOptions,
  modelCatalog,
  channelDefaults,
  text,
}: CreateDialogProps) {
  const open = useObservable(createDialog)
  if (!open) return null
  return (
    <BotDialog
      t={t}
      text={text}
      creationOptions={creationOptions}
      modelCatalog={modelCatalog}
      channelDefaults={channelDefaults}
      onSubmit={createBot}
      onClose={() => createDialog.set(false)}
      returnFocus="[data-dshb-new-bot]"
    />
  )
}

export interface BotDialogProps extends CreationSources {
  t: Translate
  text(text: BotChannelText): string
  onSubmit(input: BotCreationRequest): Promise<void>
  onClose(): void
  returnFocus?: string
}

export function BotDialog({
  t,
  text,
  creationOptions,
  modelCatalog,
  channelDefaults,
  onSubmit,
  onClose,
  returnFocus,
}: BotDialogProps) {
  const [opener] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  )
  const form = useBotCreationForm(t, { creationOptions, modelCatalog, channelDefaults })
  const dialogRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback(() => onClose(), [onClose])
  useLayer(dialogRef, {
    active: true,
    trap: true,
    onEscape: close,
    restore: () =>
      returnFocus === undefined ? opener : document.querySelector<HTMLElement>(returnFocus),
  })

  const submit = async () => {
    if (await form.submit(onSubmit)) close()
  }

  const titleId = `${id}-title`
  const formId = `${id}-form`

  return (
    <div className="dshb-modal-root">
      <div className="dshb-modal-mask" aria-hidden="true" onClick={close} />
      <div
        ref={dialogRef}
        className="dshb-modal dshb-create"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-dshb-create-dialog=""
      >
        <div className="dshb-modal-header">
          <h2 id={titleId} className="dshb-modal-title">
            {t("section.new")}
          </h2>
          <Button variant="icon" label={t("form.close")} onClick={close}>
            <IconClose />
          </Button>
        </div>
        <form
          className="dshb-modal-body"
          id={formId}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <BotCreationFields t={t} text={text} form={form} autoFocus />
        </form>
        <div className="dshb-modal-footer">
          <Button variant="secondary" onClick={close}>
            {t("form.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={form.blocked}
            marks={{ "data-dshb-create-submit": "" }}
          >
            {form.busy ? t("form.creating") : t("form.create")}
          </Button>
        </div>
      </div>
    </div>
  )
}
