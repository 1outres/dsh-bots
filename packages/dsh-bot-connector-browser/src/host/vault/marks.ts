export const FILL_ATTRIBUTE = "data-dsh-fill"
export const PASSKEY_ATTRIBUTE = "data-dsh-passkey"

const MARK = /^[0-9a-f]{32}$/

export function checkMark(mark: string): string {
  if (!MARK.test(mark)) throw new Error("a mark is 32 lower-case hex digits")
  return mark
}

export const markElement = (mark: string) =>
  `(element) => { element.setAttribute("${FILL_ATTRIBUTE}", "${checkMark(mark)}"); return "marked" }`

export const markTab = (mark: string) =>
  `() => { document.documentElement.setAttribute("${PASSKEY_ATTRIBUTE}", "${checkMark(mark)}"); return "marked" }`
