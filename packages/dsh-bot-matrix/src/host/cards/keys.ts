import type { BotApprovalAction } from "@1outres/dsh-bot-core"

export const DIGITS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"] as const
export const HOLD = "⏸️"
export const APPROVE = "✅"
export const REJECT = "❌"
export const ALWAYS = "🔁"

export const APPROVAL_KEYS: Readonly<Record<BotApprovalAction, string>> = {
  "allow-once": APPROVE,
  always: ALWAYS,
  reject: REJECT,
}

export const approvalOfKey = (key: string): BotApprovalAction | undefined =>
  (Object.entries(APPROVAL_KEYS) as [BotApprovalAction, string][]).find(
    ([, value]) => value === key,
  )?.[0]

export const digitOf = (key: string): number | undefined => {
  const at = DIGITS.indexOf(key as (typeof DIGITS)[number])
  return at < 0 ? undefined : at
}
