/**
 * The one-time marks Playwright MCP puts on what a login goes to, so that
 * the helper finds it over DevTools by itself (the value never goes
 * through Playwright MCP). A mark is 32 lower-case hex digits.
 */
export const FILL_ATTRIBUTE = "data-dsh-fill"
export const PASSKEY_ATTRIBUTE = "data-dsh-passkey"

const MARK = /^[0-9a-f]{32}$/

export function checkMark(mark: string): string {
  if (!MARK.test(mark)) throw new Error("a mark is 32 lower-case hex digits")
  return mark
}

/** browser_evaluate's function for the element of a ref. */
export const markElement = (mark: string) =>
  `(element) => { element.setAttribute("${FILL_ATTRIBUTE}", "${checkMark(mark)}"); return "marked" }`

/** browser_evaluate's function for the current tab's document. */
export const markTab = (mark: string) =>
  `() => { document.documentElement.setAttribute("${PASSKEY_ATTRIBUTE}", "${checkMark(mark)}"); return "marked" }`
