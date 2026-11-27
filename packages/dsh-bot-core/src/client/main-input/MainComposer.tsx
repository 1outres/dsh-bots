import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useObservable } from "../hooks"
import { IconClose, IconPlus, Spinner } from "../icons"
import type { Translate } from "../types"
import { type DraftAttachment, isImage } from "./draft"
import { keyIntent } from "./keys"
import type { MainComposerModel } from "./model"
import { availabilityOf, type ComposerState, primaryActionOf } from "./state"

export interface MainComposerFace {
  composerOf(sessionId: string | undefined): MainComposerModel | undefined
}

export interface MainComposerProps extends MainComposerFace {
  readonly t: Translate
  readonly sessionId?: string
  readonly variant: "hero" | "composer"
  readonly disabled?: boolean
  readonly blocked?: { readonly reason: string }
  readonly placeholder?: string
}

export function MainComposer(props: MainComposerProps) {
  const model = props.composerOf(props.sessionId)
  if (model === undefined) return null
  return <ComposerCard {...props} model={model} />
}

function placeholderOf(props: MainComposerProps, composer: ComposerState): string {
  if (props.blocked !== undefined) return props.blocked.reason
  if (props.placeholder !== undefined) return props.placeholder
  const availability = availabilityOf(composer)
  if (availability.kind === "unavailable")
    return props.t(`mainComposer.unavailable.${availability.reason}`)
  return props.t("mainComposer.placeholder")
}

function filesOf(list: FileList | null | undefined): File[] {
  return list === null || list === undefined ? [] : [...list]
}

function ComposerCard(props: MainComposerProps & { readonly model: MainComposerModel }) {
  const { t, model } = props
  const composer = useObservable(model)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const ready = availabilityOf(composer).kind === "ready"
  const locked = props.disabled === true || props.blocked !== undefined || !ready
  const editable = !locked && !composer.sending
  const primary = primaryActionOf(composer, locked)
  const placeholder = placeholderOf(props, composer)
  const { text } = composer.draft

  useLayoutEffect(() => {
    const area = textRef.current
    if (area === null) return
    area.style.height = "auto"
    area.style.height = `${area.scrollHeight}px`
  }, [text])

  useEffect(() => {
    if (!editable || window.matchMedia("(pointer: coarse)").matches) return
    textRef.current?.focus({ preventScroll: true })
  }, [editable, model])

  const add = (files: readonly File[]) => {
    if (!editable || files.length === 0) return
    model.addFiles(files)
  }
  const submit = () => {
    if (primary.kind === "send" && primary.enabled) void model.send()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const intent = keyIntent({
      key: event.key,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    })
    if (intent !== "submit") return
    event.preventDefault()
    submit()
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesOf(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    add(files)
  }
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!editable || !event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setDragging(true)
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    setDragging(false)
    if (!editable) return
    event.preventDefault()
    add(filesOf(event.dataTransfer.files))
  }
  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = filesOf(event.target.files)
    event.target.value = ""
    add(picked)
  }

  return (
    <div
      className="dshb-mc"
      data-dshb-main-composer=""
      data-variant={props.variant}
      data-locked={locked ? "" : undefined}
    >
      {composer.notice !== undefined && (
        <div className="dshb-mc-notice" role="alert">
          <span>{composer.notice}</span>
          <button
            type="button"
            className="dshb-mc-icon"
            aria-label={t("mainComposer.dismiss")}
            onClick={() => model.dismissNotice()}
          >
            <IconClose size={12} />
          </button>
        </div>
      )}
      <section
        className="dshb-mc-card"
        aria-label={t("mainComposer.label")}
        data-dragging={dragging ? "" : undefined}
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {composer.draft.attachments.length > 0 && (
          <ul className="dshb-mc-attachments" aria-label={t("mainComposer.attachments")}>
            {composer.draft.attachments.map((attachment) => (
              <AttachmentChip
                key={attachment.key}
                t={t}
                attachment={attachment}
                removable={!composer.sending}
                remove={() => model.removeAttachment(attachment.key)}
              />
            ))}
          </ul>
        )}
        <div className="dshb-mc-scroll">
          <textarea
            ref={textRef}
            className="dshb-mc-input"
            rows={1}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={locked}
            readOnly={composer.sending}
            onChange={(event) => model.setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
        <div className="dshb-mc-row">
          <button
            type="button"
            className="dshb-mc-add"
            aria-label={t("mainComposer.attach")}
            title={t("mainComposer.attach")}
            disabled={!editable}
            onClick={() => fileRef.current?.click()}
          >
            <IconPlus size={14} />
          </button>
          <input ref={fileRef} type="file" multiple hidden disabled={!editable} onChange={onPick} />
          <PrimaryButton t={t} composer={composer} locked={locked} model={model} submit={submit} />
        </div>
      </section>
    </div>
  )
}

function PrimaryButton(props: {
  readonly t: Translate
  readonly composer: ComposerState
  readonly locked: boolean
  readonly model: MainComposerModel
  submit(): void
}) {
  const { t } = props
  const primary = primaryActionOf(props.composer, props.locked)
  switch (primary.kind) {
    case "sending":
      return (
        <button
          type="button"
          className="dshb-mc-primary"
          aria-label={t("mainComposer.sending")}
          aria-busy="true"
          data-sending=""
          disabled
        >
          <Spinner size={16} />
        </button>
      )
    case "stop":
      return (
        <button
          type="button"
          className="dshb-mc-primary"
          aria-label={t("mainComposer.stop")}
          title={t("mainComposer.stop")}
          data-action="stop"
          disabled={!primary.enabled}
          onClick={() => props.model.stop()}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" />
          </svg>
        </button>
      )
    case "send":
      return (
        <button
          type="button"
          className="dshb-mc-primary"
          aria-label={t("mainComposer.send")}
          title={t("mainComposer.send")}
          data-action="send"
          disabled={!primary.enabled}
          onClick={props.submit}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 1.5 14 7.5 12.6 8.9 9 5.3V15H7V5.3L3.4 8.9 2 7.5Z" fill="currentColor" />
          </svg>
        </button>
      )
  }
}

function AttachmentChip(props: {
  readonly t: Translate
  readonly attachment: DraftAttachment
  readonly removable: boolean
  remove(): void
}) {
  const { t, attachment } = props
  const { status } = attachment
  const percent =
    status.kind === "uploading" && attachment.bytes > 0
      ? Math.floor((status.sent / attachment.bytes) * 100)
      : undefined
  return (
    <li
      className="dshb-mc-chip"
      data-status={status.kind}
      data-kind={isImage(attachment) ? "image" : "file"}
      title={status.kind === "failed" ? status.message : attachment.name}
    >
      {isImage(attachment) && attachment.preview !== undefined ? (
        <img className="dshb-mc-thumb" src={attachment.preview} alt={attachment.name} />
      ) : (
        <span className="dshb-mc-chip-name">{attachment.name}</span>
      )}
      {status.kind === "uploading" && (
        <span className="dshb-mc-chip-state" role="status">
          {percent === undefined ? <Spinner size={12} /> : `${percent}%`}
        </span>
      )}
      {status.kind === "failed" && (
        <span className="dshb-mc-chip-state" data-tone="danger">
          {t("mainComposer.uploadFailed")}
        </span>
      )}
      {props.removable && (
        <button
          type="button"
          className="dshb-mc-chip-remove"
          aria-label={t("mainComposer.remove", { name: attachment.name })}
          onClick={props.remove}
        >
          <IconClose size={10} />
        </button>
      )}
    </li>
  )
}
