import { type RefObject, useEffect, useRef } from "react"

/** One surface that takes Escape (and, when it traps, Tab and focus) while it is the top layer. */
export interface Layer {
  element(): HTMLElement | null
  readonly trap: boolean
  escape(): void
}

/** The open layers of a document, bottom first. */
export interface LayerStack {
  /** @returns the disposer that removes `layer`. */
  push(layer: Layer): () => void
  /** The layer Escape goes to. */
  top(): Layer | undefined
  /** The layer Tab and focus stay inside. */
  topTrap(): Layer | undefined
  size(): number
}

export function createLayerStack(): LayerStack {
  const layers: Layer[] = []
  return {
    push(layer) {
      layers.push(layer)
      return () => {
        const index = layers.indexOf(layer)
        if (index >= 0) layers.splice(index, 1)
      }
    },
    top: () => layers.at(-1),
    topTrap: () => [...layers].reverse().find((layer) => layer.trap),
    size: () => layers.length,
  }
}

const FOCUSABLE =
  "button:not(:disabled), input:not(:disabled):not([type=file]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex='0']"

const focusables = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.closest("[inert], [hidden]") === null,
  )

/** Where focus lands in a layer: its `data-dshb-autofocus` element, else the first control. */
export function focusHome(container: HTMLElement): void {
  const home =
    container.querySelector<HTMLElement>("[data-dshb-autofocus]") ??
    focusables(container)[0] ??
    container
  home.focus()
}

function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  const items = focusables(container)
  const first = items[0]
  const last = items.at(-1)
  if (first === undefined || last === undefined) {
    event.preventDefault()
    return
  }
  const active = container.ownerDocument.activeElement
  const outside = !(active instanceof Node) || !container.contains(active)
  if (outside || (event.shiftKey && active === first)) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

const stacks = new WeakMap<Document, LayerStack>()

function stackOf(doc: Document): LayerStack {
  const known = stacks.get(doc)
  if (known !== undefined) return known
  const stack = createLayerStack()
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key === "Escape") {
      const layer = stack.top()
      if (layer === undefined) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) layer.escape()
      return
    }
    if (event.key !== "Tab") return
    const container = stack.topTrap()?.element()
    if (container === null || container === undefined) return
    event.stopPropagation()
    trapTab(event, container)
  }
  const onFocusIn = (event: FocusEvent) => {
    const container = stack.topTrap()?.element()
    if (container === null || container === undefined) return
    if (event.target instanceof Node && container.contains(event.target)) return
    focusHome(container)
  }
  let attached = false
  const sync = () => {
    const open = stack.size() > 0
    if (open === attached) return
    attached = open
    if (open) {
      doc.addEventListener("keydown", onKey, true)
      doc.addEventListener("focusin", onFocusIn)
    } else {
      doc.removeEventListener("keydown", onKey, true)
      doc.removeEventListener("focusin", onFocusIn)
    }
  }
  const bound: LayerStack = {
    push(layer) {
      const pop = stack.push(layer)
      sync()
      return () => {
        pop()
        sync()
      }
    },
    top: stack.top,
    topTrap: stack.topTrap,
    size: stack.size,
  }
  stacks.set(doc, bound)
  return bound
}

export interface LayerOptions {
  /** Whether the layer is open; it joins the top of the stack when this turns true. */
  readonly active: boolean
  onEscape(): void
  /** Whether Tab cycles inside the element and focus is held in it (dialogs), or not (popovers, a field's draft). */
  readonly trap: boolean
  /** Where focus goes once a trapping layer closes; the element focused when it opened when omitted. */
  restore?(): HTMLElement | null
}

/**
 * Put the element on the document's layer stack while active: the top layer
 * gets Escape before anything else on the page; a trapping layer keeps Tab and
 * focus inside it, takes focus when it opens and gives it back when it closes.
 */
export function useLayer(ref: RefObject<HTMLElement | null>, options: LayerOptions): void {
  const latest = useRef(options)
  latest.current = options
  const { active, trap } = options
  useEffect(() => {
    const element = ref.current
    if (!active || element === null) return
    const doc = element.ownerDocument
    const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null
    const pop = stackOf(doc).push({
      element: () => ref.current,
      trap,
      escape: () => latest.current.onEscape(),
    })
    if (trap && !element.contains(doc.activeElement)) focusHome(element)
    return () => {
      pop()
      if (!trap) return
      const target = latest.current.restore?.() ?? previous
      setTimeout(() => {
        if (target?.isConnected && target.closest("[inert]") === null) target.focus()
      }, 0)
    }
  }, [ref, active, trap])
}
