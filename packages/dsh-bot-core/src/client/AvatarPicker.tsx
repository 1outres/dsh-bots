import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react"
import { Avatar } from "./Avatar"
import {
  AVATAR_COLORS,
  type AvatarChoice,
  composeAvatar,
  EMOJI_CHOICES,
  type GlyphChoice,
  initialOf,
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
  const glyphs: GlyphChoice[] = [...EMOJI_CHOICES.keys(), "initial"]
  const initial = initialOf(name)
  const glyphLabel = (choice: GlyphChoice) =>
    choice === "initial" ? t("avatar.initial", { letter: initial }) : t(`avatar.${choice}`)

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
          label={t("form.glyph")}
          count={glyphs.length}
          selected={glyphs.indexOf(value.glyph)}
          active={!imageInUse}
          onSelect={(index) => onChange({ ...value, image: undefined, glyph: glyphs[index] ?? 0 })}
          render={(index) => {
            const choice = glyphs[index] ?? 0
            return {
              label: glyphLabel(choice),
              content: <Avatar avatar={composeAvatar(choice, value.color, name)} size={24} />,
            }
          }}
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
        <RadioRow
          label={t("form.color")}
          count={AVATAR_COLORS.length}
          selected={AVATAR_COLORS.indexOf(value.color as (typeof AVATAR_COLORS)[number])}
          active={!imageInUse}
          onSelect={(index) =>
            onChange({
              ...value,
              image: undefined,
              color: AVATAR_COLORS[index] ?? AVATAR_COLORS[0],
            })
          }
          render={(index) => ({
            label: t(`color.${index}`),
            content: (
              <span className="dshb-avatar-swatch" style={{ background: AVATAR_COLORS[index] }} />
            ),
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

interface RadioRowProps {
  label: string
  count: number
  selected: number
  active: boolean
  onSelect(index: number): void
  render(index: number): { label: string; content: ReactNode }
}

function RadioRow({ label, count, selected, active, onSelect, render }: RadioRowProps) {
  const stop = selected < 0 ? 0 : selected
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = radioStep(event.key, index, count)
    if (next === undefined) return
    event.preventDefault()
    onSelect(next)
    const row = event.currentTarget.parentElement
    ;(row?.children[next] as HTMLElement | undefined)?.focus()
  }
  return (
    <div className="dshb-avatar-radios" role="radiogroup" aria-label={label}>
      {Array.from({ length: count }, (_, index) => {
        const item = render(index)
        const checked = active && index === selected
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
            onClick={() => onSelect(index)}
          >
            {item.content}
          </button>
        )
      })}
    </div>
  )
}
