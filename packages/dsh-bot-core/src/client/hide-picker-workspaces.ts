import { BOT_PRESET_DESCRIPTION_PREFIX } from "../shared/preset"

export interface PickerRow {
  readonly folder: boolean
  readonly selected: boolean
  readonly label: string
}

export function isBotPresetRow(row: PickerRow): boolean {
  return !row.folder && !row.selected && row.label.includes(`${BOT_PRESET_DESCRIPTION_PREFIX}"`)
}

const FOLDER_ICON = '[data-icon="dsw-icon-folder-close-regular"]'
const CHECK_ICON = '[data-icon="dsw-icon-check-outline-regular"]'
const MARK = "data-dshb-bot-workspace"
const DISABLED_MARK = "data-dshb-bot-disabled"

export const PICKER_CSS = `[${MARK}] { display: none !important; }`

function readRow(item: Element): PickerRow {
  return {
    folder: item.querySelector(FOLDER_ICON) !== null,
    selected:
      item.querySelector(CHECK_ICON) !== null || item.getAttribute("aria-checked") === "true",
    label: item.textContent ?? "",
  }
}

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

export function markMenu(menu: Element): void {
  for (const item of menu.querySelectorAll('[role="menuitem"]')) {
    const host =
      item.parentElement !== menu && item.parentElement !== null ? item.parentElement : item
    const row = readRow(item)
    const hide = isBotPresetRow(row)
    if (hide !== host.hasAttribute(MARK)) host.toggleAttribute(MARK, hide)
    setInert(item, hide)
  }
}

export function unmarkMenu(menu: Element): void {
  for (const marked of menu.querySelectorAll(`[${MARK}]`)) marked.removeAttribute(MARK)
  for (const item of menu.querySelectorAll(`[${DISABLED_MARK}]`)) setInert(item, false)
}

export interface PickerWatch {
  dispose(): void
}

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
