import type { VaultFieldRef } from "@1outres/dsh-bot-core"

const OP_ID = /^[A-Za-z0-9_]{1,64}$/

export const isOpId = (value: unknown): value is string =>
  typeof value === "string" && OP_ID.test(value)

export function requireOpId(value: unknown, what: string): string {
  if (!isOpId(value)) throw new Error(`not a 1Password ${what} id`)
  return value
}

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
