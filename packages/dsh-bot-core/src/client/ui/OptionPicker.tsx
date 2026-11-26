import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { IconChevronDown, IconSearch } from "../icons"
import type { Translate } from "../types"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import { type Placement, placeUnder } from "./placement"

/** One option of an {@link OptionPicker}: a name, a line under it, a picture. */
export interface PickerOption {
  readonly value: string
  readonly label: string
  readonly detail?: string
  readonly image?: string
}

export interface OptionPickerProps {
  readonly t: Translate
  readonly options: readonly PickerOption[]
  /** The values picked, in order; a value no option has is shown by `unknown`. */
  readonly selected: readonly string[]
  /** Many values (toggled, up to `max`), or one (picking replaces it). */
  readonly multiple: boolean
  readonly max?: number
  onChange(values: readonly string[]): void
  unknown(value: string): PickerOption
  readonly placeholder: string
  /** The control's accessible name (the row's label). */
  readonly label: string
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

function Face({ option }: { readonly option: PickerOption }) {
  return (
    <>
      {option.image === undefined ? (
        <span className="dshb-ui-picker-image" aria-hidden="true" />
      ) : (
        <img
          className="dshb-ui-picker-image"
          src={option.image}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}
      <span className="dshb-ui-picker-text">
        <span className="dshb-ui-picker-label">{option.label}</span>
        {option.detail !== undefined && (
          <span className="dshb-ui-picker-detail">{option.detail}</span>
        )}
      </span>
    </>
  )
}

const matches = (option: PickerOption, words: readonly string[]) => {
  const text = `${option.label} ${option.detail ?? ""}`.toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * A choice among options a channel gives (people, places): each with its
 * picture, name and a line under it, filtered by a search field.
 */
export function OptionPicker(props: OptionPickerProps) {
  const { t, options, selected, multiple, onChange, label, disabled, marks } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const listId = `${id}-list`
  const optionId = (index: number) => `${id}-option-${index}`
  const shown = useMemo(() => {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== "")
    return options.filter((option) => matches(option, words))
  }, [options, query])
  const picked = selected.map(
    (value) => options.find((option) => option.value === value) ?? props.unknown(value),
  )
  const full = multiple && props.max !== undefined && selected.length >= props.max

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setQuery("")
    if (refocus) triggerRef.current?.focus()
  }, [])
  const pick = (option: PickerOption | undefined) => {
    if (option === undefined) return
    if (!multiple) {
      if (selected[0] !== option.value) onChange([option.value])
      close(true)
      return
    }
    if (selected.includes(option.value))
      onChange(selected.filter((value) => value !== option.value))
    else if (!full) onChange([...selected, option.value])
  }

  useLayer(popoverRef, { active: open, trap: false, onEscape: () => close(true) })

  useEffect(() => {
    if (!open || triggerRef.current === null) return
    const trigger = triggerRef.current
    const place = () => setPlacement(placeUnder(trigger))
    place()
    window.addEventListener("resize", place)
    return () => window.removeEventListener("resize", place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [open, close])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((index) => Math.min(Math.max(index + step, 0), Math.max(shown.length - 1, 0)))
    } else if (event.key === "Enter") {
      event.preventDefault()
      pick(shown[active])
    } else if (event.key === "Tab") {
      close(false)
    }
  }

  return (
    <span className="dshb-ui-picker">
      <button
        ref={triggerRef}
        type="button"
        className="dshb-ui-select dshb-ui-picker-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        {...marks}
      >
        <span className="dshb-ui-picker-picked">
          {picked.length === 0 ? (
            <span className="dshb-ui-picker-placeholder">{props.placeholder}</span>
          ) : (
            picked.map((option) => (
              <span
                key={option.value}
                className="dshb-ui-picker-chip"
                data-dshb-picked={option.value}
              >
                <Face option={option} />
              </span>
            ))
          )}
        </span>
        <span className="dshb-ui-select-chevron" aria-hidden="true">
          <IconChevronDown size={14} />
        </span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="dshb-ui-popover"
          style={placement === null ? { visibility: "hidden" } : placement}
        >
          <span className="dshb-ui-popover-search">
            <IconSearch size={14} />
            <input
              className="dshb-ui-popover-input"
              // biome-ignore lint/a11y/noAutofocus: the list opens for typing its filter
              autoFocus
              role="combobox"
              aria-label={t("ui.select.search")}
              aria-controls={listId}
              aria-expanded="true"
              aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
              placeholder={t("ui.select.search")}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
            />
          </span>
          <div
            className="dshb-ui-popover-list"
            role="listbox"
            id={listId}
            aria-label={label}
            aria-multiselectable={multiple}
          >
            {shown.map((option, index) => {
              const on = selected.includes(option.value)
              const off = !on && full
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the search field drives the options with the arrow keys and Enter (aria-activedescendant)
                <div
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={on}
                  aria-disabled={off ? true : undefined}
                  data-active={index === active ? "" : undefined}
                  className="dshb-ui-popover-option dshb-ui-picker-option"
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(option)}
                >
                  <Face option={option} />
                </div>
              )
            })}
            {shown.length === 0 && <p className="dshb-ui-popover-none">{t("ui.select.none")}</p>}
          </div>
        </div>
      )}
    </span>
  )
}
