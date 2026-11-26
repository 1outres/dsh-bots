export const characters = (text: string) => [...text].length

const WORD = /[\p{L}\p{N}]/u
const ASCII_WORD = /[A-Za-z0-9]/u

export function standsAlone(text: string, start: number, end: number): boolean {
  const first = text.slice(start, start + 1)
  const last = text.slice(end - 1, end)
  if (ASCII_WORD.test(first) && WORD.test(text.slice(start - 1, start))) return false
  if (ASCII_WORD.test(last) && WORD.test(text.slice(end, end + 1))) return false
  return true
}

export const groupDigits = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",")
