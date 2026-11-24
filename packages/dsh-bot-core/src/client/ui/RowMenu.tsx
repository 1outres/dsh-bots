import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react"
import { IconEllipsis } from "../icons"
import { useLayer } from "./layers"
import type { DataMarks } from "./marks"
import { type Placement, placeUnder } from "./placement"

/** One entry of a row's menu. */
export interface RowMenuItem {
  readonly id: string
  readonly label: string
  /** `danger`: a destructive entry (Disconnect…), in red. */
  readonly tone?: "danger"
  readonly disabled?: boolean
  run(): void
}

export interface RowMenuProps {
  /** The menu button's accessible name (More for {account}). */
  readonly label: string
  readonly items: readonly RowMenuItem[]
  readonly disabled?: boolean
  readonly marks?: DataMarks
}

const MENU_WIDTH = 180

/** A row's `…` button and the menu it opens: ↑/↓ move, Enter picks, Escape or a click elsewhere closes. */
export function RowMenu({ label, items, disabled, marks }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])
  useLayer(menuRef, { active: open, trap: false, onEscape: () => close(true) })

  useEffect(() => {
    if (!open || triggerRef.current === null) return
    const trigger = triggerRef.current
    const place = () => setPlacement(placeUnder(trigger, MENU_WIDTH))
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) || trigger.contains(target)) return
      close(false)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
      document.removeEventListener("pointerdown", onPointerDown, true)
    }
  }, [open, close])

  useEffect(() => {
    if (!open || placement === null) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open, placement])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      close(false)
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const entries = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ]
    const at = entries.findIndex((entry) => entry === document.activeElement)
    const step = event.key === "ArrowDown" ? 1 : -1
    entries[(at + step + entries.length) % entries.length]?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dshb-ui-button"
        data-variant="icon"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : setOpen(true))}
        {...marks}
      >
        <IconEllipsis size={16} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={label}
          className="dshb-ui-popover dshb-ui-menu"
          style={placement === null ? { visibility: "hidden" } : placement}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="dshb-ui-menu-item"
              data-tone={item.tone}
              disabled={item.disabled}
              data-dshb-row-menu-item={item.id}
              onClick={() => {
                close(true)
                item.run()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
