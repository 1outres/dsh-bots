import { localeFormat } from "../locale-format"
import type { Translate } from "../types"

const KIB = 1024
const MIB = 1024 * 1024

const rounded = (value: number) => Math.round(value * 10) / 10

export function sizeText(t: Translate, bytes: number): string {
  const format = localeFormat(t)
  if (bytes < KIB) return t("spaces.size.bytes", { value: format.number(bytes) })
  if (bytes < MIB) return t("spaces.size.kib", { value: format.number(rounded(bytes / KIB)) })
  return t("spaces.size.mib", { value: format.number(rounded(bytes / MIB)) })
}
