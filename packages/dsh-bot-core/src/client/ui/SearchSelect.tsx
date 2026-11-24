import {
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { IconChevronDown, IconSearch } from "../icons"
import type { Translate } from "../types"
import { type Choice, searchChoices } from "./choices"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import { type Placement, placeUnder } from "./placement"

export interface SearchSelectProps<Value extends string> {
  readonly t: Translate
  readonly value: Value
  readonly choices: readonly Choice<Value>[]
  /** Called when another choice is picked; the setting is saved then. */
  onChange(value: Value): void
  /** The control's accessible name (the row's label). */
  readonly label: string
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

/**
 * A select over a long list (time zones, models): the list opens with a
 * search field that filters it; grouped choices are listed under their group.
 */
export function SearchSelect<Value extends string>(props: SearchSelectProps<Value>) {
  const { t, value, choices, onChange, label, disabled, marks } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const listId = `${id}-list`
  const optionId = (index: number) => `${id}-option-${index}`
  const shown = useMemo(() => searchChoices(choices, query), [choices, query])
  const current = choices.find((choice) => choice.value === value)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setQuery("")
    if (refocus) triggerRef.current?.focus()
  }, [])
  const pick = (choice: Choice<Value> | undefined) => {
    if (choice === undefined || choice.disabled === true) return
    if (choice.value !== value) onChange(choice.value)
    close(true)
  }

  useLayer(popoverRef, { active: open, trap: false, onEscape: () => close(true) })

  useEffect(() => {
    if (!open || triggerRef.current === null) return
    const trigger = triggerRef.current
    const place = () => setPlacement(placeUnder(trigger))
    place()
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return
      place()
    }
    window.addEventListener("resize", place)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", onScroll, true)
    }
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

  useEffect(() => {
    if (!open) return
    const selected = shown.findIndex((choice) => choice.value === value)
    setActive(Math.max(selected, 0))
  }, [open, shown, value])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: "nearest" })
  })

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
    <span className="dshb-ui-search-select">
      <button
        ref={triggerRef}
        type="button"
        className="dshb-ui-select"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        {...marks}
      >
        <span className="dshb-ui-select-value">{current?.label ?? value}</span>
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
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
          </span>
          <div
            ref={listRef}
            className="dshb-ui-popover-list"
            role="listbox"
            id={listId}
            aria-label={label}
          >
            {shown.map((choice, index) => (
              <Fragment key={choice.value}>
                {choice.group !== undefined && choice.group !== shown[index - 1]?.group && (
                  <div className="dshb-ui-popover-group" role="presentation">
                    {choice.group}
                  </div>
                )}
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: the search field drives the options with the arrow keys and Enter (aria-activedescendant) */}
                <div
                  id={optionId(index)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={choice.value === value}
                  aria-disabled={choice.disabled === true ? true : undefined}
                  data-active={index === active ? "" : undefined}
                  className="dshb-ui-popover-option"
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(choice)}
                  title={choice.title}
                >
                  {choice.label}
                </div>
              </Fragment>
            ))}
            {shown.length === 0 && <p className="dshb-ui-popover-none">{t("ui.select.none")}</p>}
          </div>
        </div>
      )}
    </span>
  )
}
