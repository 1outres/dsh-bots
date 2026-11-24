/** A month of the notes calendar, as weeks from Sunday; `null` pads the first and last week. */
export type MonthGrid = readonly (readonly (string | null)[])[]

const MONTH = /^(\d{4})-(\d{2})$/u

function partsOf(month: string): { year: number; month: number } {
  const match = MONTH.exec(month)
  if (match === null) throw new Error(`not a month: ${month}`)
  return { year: Number(match[1]), month: Number(match[2]) }
}

const pad = (value: number, length: number) => String(value).padStart(length, "0")

export const monthOf = (year: number, month: number) => `${pad(year, 4)}-${pad(month, 2)}`

/** The month `delta` months after `month`. */
export function shiftMonth(month: string, delta: number): string {
  const { year, month: index } = partsOf(month)
  const total = year * 12 + (index - 1) + delta
  return monthOf(Math.floor(total / 12), (total % 12) + 1)
}

export function monthGrid(month: string): MonthGrid {
  const { year, month: index } = partsOf(month)
  const first = new Date(Date.UTC(year, index - 1, 1)).getUTCDay()
  const days = new Date(Date.UTC(year, index, 0)).getUTCDate()
  const cells: (string | null)[] = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: days }, (_, day) => `${month}-${pad(day + 1, 2)}`),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let start = 0; start < cells.length; start += 7) weeks.push(cells.slice(start, start + 7))
  return weeks
}
