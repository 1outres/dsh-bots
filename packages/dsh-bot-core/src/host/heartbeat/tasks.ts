const COMMENT = /<!--[\s\S]*?(?:-->|$)/g
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/
const EMPTY_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s+\[[ xX]?\])?\s*$/

const blank = (line: string) => line.trim() === "" || HEADING.test(line) || EMPTY_ITEM.test(line)

export function hasHeartbeatTasks(text: string): boolean {
  return !text.replace(COMMENT, "").split(/\r?\n/).every(blank)
}
