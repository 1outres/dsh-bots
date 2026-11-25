import type { VaultFieldRef } from "@1outres/dsh-bot-core"

/**
 * 1Password ids as this provider accepts them: letters, digits and `_`
 * (one-time password fields are `TOTP_<id>`), so a secret reference built
 * from them names exactly one field and cannot carry another path segment
 * or query.
 */
const OP_ID = /^[A-Za-z0-9_]{1,64}$/

export const isOpId = (value: unknown): value is string =>
  typeof value === "string" && OP_ID.test(value)

/** @throws when an id is not one this provider accepts. */
export function requireOpId(value: unknown, what: string): string {
  if (!isOpId(value)) throw new Error(`not a 1Password ${what} id`)
  return value
}

/** `op://<vault>/<item>/<field>`, with `?attribute=otp` for a one-time code. */
export function secretReference(ref: VaultFieldRef): string {
  const path = [
    requireOpId(ref.vaultId, "vault"),
    requireOpId(ref.itemId, "item"),
    requireOpId(ref.fieldId, "field"),
  ].join("/")
  if (ref.kind === "password") return `op://${path}`
  if (ref.kind === "otp") return `op://${path}?attribute=otp`
  throw new Error(`1Password hands out no ${String(ref.kind)}`)
}
