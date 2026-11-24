import { Fragment, type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react"
import { useObservable, useOptionalObservable } from "../hooks"
import { IconEllipsis } from "../icons"
import type { Observable } from "../observable"
import type { ShellMenuContext, ShellMenuEntry } from "../shell-menu"
import type { Translate } from "../types"
import { useLayer } from "../ui"

/** The roving tab stop a toolbar or menu hands each of its buttons. */
export interface EntryFocus {
  readonly tabIndex: number
  onFocus(): void
}

/** The response of a vertical list of buttons to a key: the index to focus, or undefined. */
export function barKey(key: string, index: number, count: number): number | undefined {
  switch (key) {
    case "ArrowDown":
      return (index + 1) % count
    case "ArrowUp":
      return (index - 1 + count) % count
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return undefined
  }
}

/** One tab stop over a vertical list of buttons: ↑/↓/Home/End move between them. */
function useRovingList(count: number) {
  const [focused, setFocused] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const tabIndex = Math.min(focused, Math.max(count - 1, 0))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return
    const next = barKey(event.key, tabIndex, count)
    if (next === undefined) return
    event.preventDefault()
    setFocused(next)
    listRef.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus()
  }
  const focusOf = (index: number): EntryFocus => ({
    tabIndex: index === tabIndex ? 0 : -1,
    onFocus: () => setFocused(index),
  })
  return { listRef, onKeyDown, focusOf }
}

/** How an entry renders in the menu bar or in the compact header's menu. */
export type EntryRender = (entry: ShellMenuEntry, focus: EntryFocus, done: () => void) => ReactNode

/**
 * The vertical menu bar beside the chat: one WAI-ARIA toolbar (a single tab
 * stop; ↑/↓/Home/End move between its buttons) of the shell menu's entries.
 */
export function ShellMenuBar(props: {
  readonly t: Translate
  readonly menu: Observable<readonly ShellMenuEntry[]>
  readonly renderEntry: EntryRender
}) {
  const entries = useObservable(props.menu)
  const roving = useRovingList(entries.length)
  return (
    <div
      ref={roving.listRef}
      className="dshb-shell-bar"
      role="toolbar"
      aria-orientation="vertical"
      aria-label={props.t("shell.menu")}
      data-dshb-shell-bar=""
      onKeyDown={roving.onKeyDown}
    >
      {entries.map((entry, index) => (
        <Fragment key={entry.id}>
          {props.renderEntry(entry, roving.focusOf(index), () => {})}
        </Fragment>
      ))}
    </div>
  )
}

/**
 * The menu bar folded into the header on a compact window: a button that
 * opens the same entries as a menu, marked while any of them waits.
 */
export function ShellMenuButton(props: {
  readonly t: Translate
  readonly menu: Observable<readonly ShellMenuEntry[]>
  readonly renderEntry: EntryRender
  /** The mark of each entry on the folded button (a dot while it waits). */
  readonly renderSignal?: (entry: ShellMenuEntry) => ReactNode
}) {
  const { t } = props
  const entries = useObservable(props.menu)
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const roving = useRovingList(entries.length)
  const close = () => setOpen(false)
  useLayer(roving.listRef, {
    active: open,
    trap: true,
    onEscape: close,
    restore: () => buttonRef.current,
  })
  const label = t("shell.menu")
  return (
    <div className="dshb-shell-menu" data-dshb-shell-menu="">
      <button
        ref={buttonRef}
        type="button"
        className="dshb-shell-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-dshb-shell-menu-button=""
        onClick={() => setOpen(!open)}
      >
        <IconEllipsis size={16} />
        {props.renderSignal !== undefined &&
          entries.map((entry) => <Fragment key={entry.id}>{props.renderSignal?.(entry)}</Fragment>)}
      </button>
      {open && (
        <>
          <div className="dshb-shell-menu-scrim" aria-hidden="true" onClick={close} />
          <div
            ref={roving.listRef}
            className="dshb-shell-menu-list"
            role="menu"
            aria-label={label}
            onKeyDown={roving.onKeyDown}
          >
            {entries.map((entry, index) => (
              <Fragment key={entry.id}>
                {props.renderEntry(entry, roving.focusOf(index), close)}
              </Fragment>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** What an entry shows for one bot session. */
function useEntryState(entry: ShellMenuEntry, context: ShellMenuContext) {
  const pressed = useOptionalObservable(useMemo(() => entry.pressed?.(context), [entry, context]))
  const disabled =
    useOptionalObservable(useMemo(() => entry.disabled?.(context), [entry, context])) === true
  const attention =
    useOptionalObservable(useMemo(() => entry.attention?.(context), [entry, context])) === true
  const count = useOptionalObservable(useMemo(() => entry.count?.(context), [entry, context])) ?? 0
  return { pressed, disabled, attention, count }
}

function entryLabel(
  t: Translate,
  entry: ShellMenuEntry,
  context: ShellMenuContext,
  waiting: boolean,
) {
  const named = entry.label(t, context.bot)
  return waiting ? t("shell.attention", { label: named }) : named
}

function runEntry(entry: ShellMenuEntry, context: ShellMenuContext, anchor: HTMLElement) {
  try {
    entry.run(context, anchor)
  } catch (error) {
    console.error(`bot-core: shell menu entry "${entry.id}" failed`, error)
  }
}

/** The count badge, else the dot, of an entry that waits for the person. */
function EntryMark({ count, attention }: { readonly count: number; readonly attention: boolean }) {
  if (count > 0) {
    return (
      <span className="dshb-waiting dshb-shell-count" aria-hidden="true">
        {count}
      </span>
    )
  }
  return attention ? <span className="dshb-shell-dot" aria-hidden="true" /> : null
}

export interface EntryProps {
  readonly t: Translate
  readonly entry: ShellMenuEntry
  readonly context: ShellMenuContext
  readonly focus: EntryFocus
}

/** An entry acting on a known bot's session, in the menu bar. */
export function EntryButton({ t, entry, context, focus }: EntryProps) {
  const state = useEntryState(entry, context)
  const label = entryLabel(t, entry, context, state.attention || state.count > 0)
  const Icon = entry.icon
  return (
    <button
      type="button"
      className="dshb-shell-button"
      data-dshb-shell-entry={entry.id}
      tabIndex={focus.tabIndex}
      aria-label={label}
      title={label}
      // aria-disabled keeps the button focusable in the toolbar while it cannot act.
      aria-disabled={state.disabled || undefined}
      aria-pressed={state.pressed}
      onFocus={focus.onFocus}
      onClick={(event) => {
        if (!state.disabled) runEntry(entry, context, event.currentTarget)
      }}
    >
      <Icon size={16} />
      <EntryMark count={state.count} attention={state.attention} />
    </button>
  )
}

/** An entry acting on a known bot's session, in the compact header's menu. */
export function EntryMenuItem(props: EntryProps & { readonly done: () => void }) {
  const { t, entry, context, focus } = props
  const state = useEntryState(entry, context)
  const Icon = entry.icon
  const named = entry.label(t, context.bot)
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      className="dshb-shell-menu-item"
      data-dshb-shell-entry={entry.id}
      tabIndex={focus.tabIndex}
      aria-checked={state.pressed === true}
      aria-disabled={state.disabled || undefined}
      aria-label={entryLabel(t, entry, context, state.attention || state.count > 0)}
      onFocus={focus.onFocus}
      onClick={(event) => {
        if (state.disabled) return
        runEntry(entry, context, event.currentTarget)
        props.done()
      }}
    >
      <Icon size={16} />
      <span className="dshb-shell-menu-label">{named}</span>
      <EntryMark count={state.count} attention={state.attention} />
    </button>
  )
}

/** The folded menu button's mark for one entry: a dot while it waits. */
export function EntrySignal({
  entry,
  context,
}: {
  readonly entry: ShellMenuEntry
  readonly context: ShellMenuContext
}) {
  const state = useEntryState(entry, context)
  return state.attention || state.count > 0 ? (
    <span className="dshb-shell-dot" aria-hidden="true" />
  ) : null
}

/** An entry of a bot session whose bot is not known yet: it cannot act. */
export function PendingEntryButton(props: {
  readonly t: Translate
  readonly entry: ShellMenuEntry
  readonly focus: EntryFocus
}) {
  const { t, entry, focus } = props
  const Icon = entry.icon
  const label = t("shell.loading")
  return (
    <button
      type="button"
      className="dshb-shell-button"
      data-dshb-shell-entry={entry.id}
      tabIndex={focus.tabIndex}
      aria-label={label}
      title={label}
      aria-disabled
      onFocus={focus.onFocus}
    >
      <Icon size={16} />
    </button>
  )
}
