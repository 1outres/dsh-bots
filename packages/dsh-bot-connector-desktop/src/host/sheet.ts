import type { AgentStep } from "./agent/protocol"

export type SheetValue = string | number | boolean | null

export interface CellAddress {
  readonly row: number
  readonly column: number
}

export const MAX_SHEET_WRITE_CELLS = 200
export const MAX_SHEET_VALUE_LENGTH = 2_000
const MAX_ROWS = 1_048_576
const MAX_COLUMNS = 16_384
const ADDRESS = /^([A-Za-z]{1,3})([1-9][0-9]{0,6})$/
const RANGE = /^([A-Za-z]{1,3}[1-9][0-9]{0,6})(?::([A-Za-z]{1,3}[1-9][0-9]{0,6}))?$/
const NAME_BOX = "ctrl+shift+F5"
const NAME_BOX_ROLE = "text"
const SHEET_ROLE = "table"

export function columnLabel(column: number): string {
  let label = ""
  for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    label = String.fromCharCode(65 + ((rest - 1) % 26)) + label
  }
  return label
}

export function formatAddress(address: CellAddress): string {
  return `${columnLabel(address.column)}${address.row + 1}`
}

export function parseAddress(text: string): CellAddress {
  const match = ADDRESS.exec(text.trim())
  if (match === null) throw new Error(`"${text}" is not a cell address like B3`)
  const letters = (match[1] ?? "").toUpperCase()
  let column = 0
  for (const letter of letters) column = column * 26 + (letter.charCodeAt(0) - 64)
  const address = { row: Number(match[2]) - 1, column: column - 1 }
  if (address.row >= MAX_ROWS || address.column >= MAX_COLUMNS) {
    throw new Error(`"${text}" is outside a sheet (${MAX_ROWS} rows, ${MAX_COLUMNS} columns)`)
  }
  return address
}

export function parseRange(text: string): {
  readonly start: CellAddress
  readonly end: CellAddress
} {
  const match = RANGE.exec(text.trim())
  if (match === null) throw new Error(`"${text}" is not a range like A1:C10`)
  const a = parseAddress(match[1] ?? "")
  const b = match[2] === undefined ? a : parseAddress(match[2])
  return {
    start: { row: Math.min(a.row, b.row), column: Math.min(a.column, b.column) },
    end: { row: Math.max(a.row, b.row), column: Math.max(a.column, b.column) },
  }
}

function cellText(value: Exclude<SheetValue, null>, at: string): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${at}: the number is not finite`)
    return String(value)
  }
  if (/[\t\r\n]/.test(value)) {
    throw new Error(`${at}: a cell value cannot hold tabs or line breaks; write one line per cell`)
  }
  if (value.length > MAX_SHEET_VALUE_LENGTH) {
    throw new Error(`${at}: the value is longer than ${MAX_SHEET_VALUE_LENGTH} characters`)
  }
  return value
}

export interface SheetWritePlan {
  readonly steps: readonly AgentStep[]
  readonly range: string
  readonly cells: number
}

export function planSheetWrite(
  windowId: string,
  start: string,
  values: readonly (readonly SheetValue[])[],
  timing: { readonly focusTimeoutMs: number },
): SheetWritePlan {
  const origin = parseAddress(start)
  const width = Math.max(0, ...values.map((row) => row.length))
  if (values.length === 0 || width === 0) throw new Error("values has no cells")
  const end = { row: origin.row + values.length - 1, column: origin.column + width - 1 }
  if (end.row >= MAX_ROWS || end.column >= MAX_COLUMNS)
    throw new Error("the values reach outside the sheet")
  const steps: AgentStep[] = [
    { kind: "activate", id: windowId },
    { kind: "key", keys: ["Escape"] },
  ]
  let cells = 0
  for (const [rowIndex, row] of values.entries()) {
    for (const [columnIndex, value] of row.entries()) {
      if (value === null) continue
      const address = formatAddress({
        row: origin.row + rowIndex,
        column: origin.column + columnIndex,
      })
      cells += 1
      if (cells > MAX_SHEET_WRITE_CELLS) {
        throw new Error(`write at most ${MAX_SHEET_WRITE_CELLS} cells per call`)
      }
      steps.push(
        { kind: "key", keys: [NAME_BOX] },
        { kind: "await_focus", role: NAME_BOX_ROLE, timeout_ms: timing.focusTimeoutMs },
        { kind: "type", text: address, paste: "ctrl+v" },
        { kind: "key", keys: ["Return"] },
        { kind: "await_focus", role: SHEET_ROLE, timeout_ms: timing.focusTimeoutMs },
      )
      const text = cellText(value, address)
      steps.push(
        text === "" ? { kind: "key", keys: ["Delete"] } : { kind: "type", text, paste: "ctrl+v" },
      )
      if (text !== "") steps.push({ kind: "key", keys: ["Return"] })
    }
  }
  if (cells === 0) throw new Error("values has only null cells: nothing to write")
  return { steps, range: `${formatAddress(origin)}:${formatAddress(end)}`, cells }
}

export interface SheetCells {
  readonly name: string
  readonly rows: number
  readonly columns: number
  readonly range: string
  readonly visible?: string
  readonly active?: string
  readonly truncated: boolean
  readonly cells: readonly { readonly address: string; readonly text: string }[]
}

export function renderSheet(sheet: SheetCells): string {
  const head = [
    `sheet ${JSON.stringify(sheet.name)} (${sheet.rows}x${sheet.columns})`,
    `range ${sheet.range}`,
    ...(sheet.visible === undefined ? [] : [`visible ${sheet.visible}`]),
    ...(sheet.active === undefined ? [] : [`active ${sheet.active}`]),
  ].join(" ")
  const rows = new Map<number, string[]>()
  for (const cell of sheet.cells) {
    const { row } = parseAddress(cell.address)
    const line = rows.get(row) ?? []
    line.push(`${cell.address}=${JSON.stringify(cell.text)}`)
    rows.set(row, line)
  }
  const body = [...rows.entries()].sort(([a], [b]) => a - b).map(([, parts]) => parts.join(" "))
  return [
    head,
    ...(body.length === 0 ? ["(no non-empty cells)"] : body),
    ...(sheet.truncated ? ["… more cells not shown; read a smaller range"] : []),
  ].join("\n")
}
