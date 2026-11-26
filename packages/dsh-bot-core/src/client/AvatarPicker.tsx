import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react"
import { initialOf } from "../shared/avatar"
import { Avatar } from "./Avatar"
import {
  AVATAR_COLORS,
  AVATAR_FIGURES,
  type AvatarChoice,
  type AvatarFigure,
  composeAvatar,
  radioStep,
} from "./avatar-data"
import {
  AVATAR_IMAGE_TYPES,
  type AvatarImage,
  AvatarImageError,
  type AvatarImageFailure,
  imageAvatar,
} from "./avatar-image"
import { IconImage, Spinner } from "./icons"
import type { Translate } from "./types"

const mebibytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

export function avatarImageMessage(t: Translate, failure: AvatarImageFailure): string {
  switch (failure.kind) {
    case "unsupported-type":
      return failure.type === ""
        ? t("avatar.error.typeUnknown")
        : t("avatar.error.type", { type: failure.type })
    case "file-too-large":
      return t("avatar.error.fileSize", {
        size: mebibytes(failure.bytes),
        limit: mebibytes(failure.limit),
      })
    case "unreadable":
      return t("avatar.error.unreadable")
    case "empty":
      return t("avatar.error.empty")
    case "canvas":
      return t("avatar.error.canvas")
    case "too-large":
      return t("avatar.error.fit", { size: failure.smallest })
  }
}

export function avatarImageNote(t: Translate, image: AvatarImage): string {
  const resized = t("avatar.note.resized", { size: image.size })
  return image.animationDropped ? `${resized} ${t("avatar.note.animation")}` : resized
}

type ImageState =
  | { readonly status: "idle" }
  | { readonly status: "reading" }
  | { readonly status: "done"; readonly image: AvatarImage }
  | { readonly status: "failed"; readonly message: string }

export interface AvatarPickerProps {
  readonly t: Translate
  readonly name: string
  readonly value: AvatarChoice
  onChange(next: AvatarChoice): void
  readonly disabled?: boolean
}

export function AvatarPicker({ t, name, value, onChange, disabled }: AvatarPickerProps) {
  const [imageState, setImageState] = useState<ImageState>({ status: "idle" })
  const fileRef = useRef<HTMLInputElement>(null)
  const statusId = useId()
  const initial = initialOf(name)
  const figureLabel = (figure: AvatarFigure) =>
    figure === "initial"
      ? t("avatar.initial", { letter: initial })
      : t(`avatar.character.${figure}`)

  const pick = async (file: File) => {
    setImageState({ status: "reading" })
    try {
      const image = await imageAvatar(file)
      setImageState({ status: "done", image })
      onChange({ ...value, image: image.avatar })
    } catch (cause) {
      setImageState({
        status: "failed",
        message:
          cause instanceof AvatarImageError
            ? avatarImageMessage(t, cause.failure)
            : t("error.generic", {
                message: cause instanceof Error ? cause.message : String(cause),
              }),
      })
    }
  }

  const imageInUse = value.image !== undefined
  return (
    <fieldset
      className="dshb-avatar-picker"
      disabled={disabled}
      aria-label={t("form.avatar")}
      data-dshb-avatar-picker=""
    >
      <div className="dshb-avatar-line">
        <RadioRow
          label={t("form.figure")}
          items={AVATAR_FIGURES}
          selected={value.figure}
          active={!imageInUse}
          onSelect={(figure) => onChange({ ...value, image: undefined, figure })}
          render={(figure) => ({
            label: figureLabel(figure),
            content: <Avatar avatar={composeAvatar(figure, value.color, name)} size={24} />,
          })}
        />
        <button
          type="button"
          className="dshb-avatar-choice"
          aria-pressed={imageInUse}
          aria-label={t("form.upload")}
          title={t("form.upload")}
          aria-describedby={imageState.status === "idle" ? undefined : statusId}
          aria-busy={imageState.status === "reading" ? true : undefined}
          disabled={imageState.status === "reading"}
          data-dshb-avatar-upload=""
          onClick={() => fileRef.current?.click()}
        >
          {imageState.status === "reading" ? (
            <Spinner size={14} />
          ) : value.image === undefined ? (
            <IconImage size={16} />
          ) : (
            <Avatar avatar={value.image} size={24} />
          )}
        </button>
      </div>
      <div className="dshb-avatar-line">
        <RadioRow<string>
          label={t("form.color")}
          items={AVATAR_COLORS}
          selected={value.color}
          active={!imageInUse}
          onSelect={(color) => onChange({ ...value, image: undefined, color })}
          render={(color, index) => ({
            label: t(`color.${index}`),
            content: <span className="dshb-avatar-swatch" style={{ background: color }} />,
          })}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={AVATAR_IMAGE_TYPES.join(",")}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file !== undefined) void pick(file)
        }}
      />
      {imageState.status === "failed" && (
        <p className="dshb-avatar-note" data-tone="danger" id={statusId} role="alert">
          {imageState.message}
        </p>
      )}
      {imageState.status === "done" && value.image === imageState.image.avatar && (
        <p className="dshb-avatar-note" id={statusId} role="status">
          {avatarImageNote(t, imageState.image)}
        </p>
      )}
    </fieldset>
  )
}

interface RadioRowProps<T> {
  readonly label: string
  readonly items: readonly T[]
  readonly selected: T
  readonly active: boolean
  onSelect(item: T): void
  render(item: T, index: number): { label: string; content: ReactNode }
}

function RadioRow<T>({ label, items, selected, active, onSelect, render }: RadioRowProps<T>) {
  const selectedIndex = items.indexOf(selected)
  const stop = Math.max(selectedIndex, 0)
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = radioStep(event.key, index, items.length)
    if (next === undefined) return
    const item = items[next]
    if (item === undefined) return
    event.preventDefault()
    onSelect(item)
    const row = event.currentTarget.parentElement
    ;(row?.children[next] as HTMLElement | undefined)?.focus()
  }
  return (
    <div className="dshb-avatar-radios" role="radiogroup" aria-label={label}>
      {items.map((value, index) => {
        const item = render(value, index)
        const checked = active && index === selectedIndex
        return (
          // biome-ignore lint/a11y/useSemanticElements: -
          <button
            key={index}
            type="button"
            className="dshb-avatar-choice"
            role="radio"
            aria-label={item.label}
            title={item.label}
            aria-checked={checked}
            tabIndex={index === stop ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onSelect(value)}
          >
            {item.content}
          </button>
        )
      })}
    </div>
  )
}
