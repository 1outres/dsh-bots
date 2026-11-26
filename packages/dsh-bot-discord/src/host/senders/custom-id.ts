import type { SenderChoice } from "@1outres/dsh-bot-core"
import { CUSTOM_ID_LIMIT } from "../discord"

const PREFIX = "dshs"
const CODES: Readonly<Record<SenderChoice, string>> = {
  "allow-address": "aa",
  "allow-domain": "ad",
  "deny-address": "da",
  "deny-domain": "dd",
}
const INQUIRY_ID = /^[A-Za-z0-9_-]{1,64}$/

export function isInquiryCustomId(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`)
}

export function encodeInquiryCustomId(inquiryId: string, choice: SenderChoice): string {
  if (!INQUIRY_ID.test(inquiryId)) throw new Error(`inquiry id "${inquiryId}" cannot be encoded`)
  const id = `${PREFIX}:${inquiryId}:${CODES[choice]}`
  if (id.length > CUSTOM_ID_LIMIT)
    throw new Error(`custom id "${id}" is longer than ${CUSTOM_ID_LIMIT}`)
  return id
}

export function decodeInquiryCustomId(
  customId: string,
): { readonly inquiryId: string; readonly choice: SenderChoice } | undefined {
  const [prefix, inquiryId, code, ...rest] = customId.split(":")
  if (prefix !== PREFIX || inquiryId === undefined || rest.length > 0) return undefined
  if (!INQUIRY_ID.test(inquiryId)) return undefined
  const choice = (Object.keys(CODES) as SenderChoice[]).find((key) => CODES[key] === code)
  return choice === undefined ? undefined : { inquiryId, choice }
}
