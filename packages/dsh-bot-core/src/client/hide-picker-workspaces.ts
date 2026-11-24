import { BOT_PRESET_DESCRIPTION_PREFIX } from "../shared/preset"

/** One menu row as read from the DOM. */
export interface PickerRow {
  /** The row shows the workspace folder icon. */
  readonly folder: boolean
  /** The row is the currently selected one. */
  readonly selected: boolean
  readonly label: string
}

/**
 * Whether a menu row offers a bot's Agent preset (the composer's preset menu).
 * That menu carries no preset id, so a row is recognized by the description
 * bot-core gives every bot preset. The selected row stays: a bot session's
 * own preset still shows.
 */
export function isBotPresetRow(row: PickerRow): boolean {
  return !row.folder && !row.selected && row.label.includes(`${BOT_PRESET_DESCRIPTION_PREFIX}"`)
}

const FOLDER_ICON = '[data-icon="dsw-icon-folder-close-regular"]'
const CHECK_ICON = '[data-icon="dsw-icon-check-outline-regular"]'
const MARK = "data-dshb-bot-workspace"
/** On a hidden row's button that this module disabled, so only those are re-enabled. */
const DISABLED_MARK = "data-dshb-bot-disabled"

/** Stylesheet companion of {@link watchWorkspacePickers}. */
export const PICKER_CSS = `[${MARK}] { display: none !important; }`

function readRow(item: Element): PickerRow {
  return {
    folder: item.querySelector(FOLDER_ICON) !== null,
    selected:
      item.querySelector(CHECK_ICON) !== null || item.getAttribute("aria-checked") === "true",
    label: item.textContent ?? "",
  }
}

/**
 * Take a hidden row out of the host Menu's keyboard walk, which (like its
 * autofocus and Tab handling) only visits `button:not(:disabled)`. A row
 * already disabled by the host keeps its state when shown again.
 */
function setInert(item: Element, inert: boolean): void {
  if (inert) {
    if (item.hasAttribute(DISABLED_MARK) || item.hasAttribute("disabled")) return
    item.setAttribute("disabled", "")
    item.setAttribute(DISABLED_MARK, "")
  } else if (item.hasAttribute(DISABLED_MARK)) {
    item.removeAttribute(DISABLED_MARK)
    item.removeAttribute("disabled")
  }
}

/** Hide and disable a menu's bot preset rows; show and re-enable the rest. */
export function markMenu(menu: Element): void {
  for (const item of menu.querySelectorAll('[role="menuitem"]')) {
    // The row's wrapper, so no empty gap stays behind; the item itself otherwise.
    const host =
      item.parentElement !== menu && item.parentElement !== null ? item.parentElement : item
    const row = readRow(item)
    const hide = isBotPresetRow(row)
    if (hide !== host.hasAttribute(MARK)) host.toggleAttribute(MARK, hide)
    setInert(item, hide)
  }
}

/** Undo {@link markMenu}. */
export function unmarkMenu(menu: Element): void {
  for (const marked of menu.querySelectorAll(`[${MARK}]`)) marked.removeAttribute(MARK)
  for (const item of menu.querySelectorAll(`[${DISABLED_MARK}]`)) setInert(item, false)
}

/** A live picker watch. */
export interface PickerWatch {
  dispose(): void
}

/**
 * Hide bot presets from the composer's preset menu ({@link isBotPresetRow}).
 * (Bots own no Workspace, so the workspace pickers have no bot rows to hide.)
 *
 * The menu reads the preset roster through a standard hook that no plugin can
 * filter, so this is DOM-level: menus are portaled straight under `<body>`,
 * so only body's children are observed (plus each open menu's own subtree).
 */
export function watchWorkspacePickers(): PickerWatch {
  const menus = new Map<Element, MutationObserver>()
  const track = (menu: Element) => {
    if (menus.has(menu)) return
    const observer = new MutationObserver(() => markMenu(menu))
    observer.observe(menu, { childList: true, subtree: true, characterData: true })
    menus.set(menu, observer)
    markMenu(menu)
  }
  const scan = () => {
    for (const [menu, observer] of menus) {
      if (!menu.isConnected) {
        observer.disconnect()
        menus.delete(menu)
      }
    }
    for (const child of document.body.children) {
      if (child.getAttribute("role") === "menu") track(child)
    }
  }
  const body = new MutationObserver(scan)
  body.observe(document.body, { childList: true })
  scan()
  return {
    dispose() {
      body.disconnect()
      for (const [menu, observer] of menus) {
        observer.disconnect()
        unmarkMenu(menu)
      }
      menus.clear()
    },
  }
}
