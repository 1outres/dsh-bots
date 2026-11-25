import type { VaultItemField, VaultItemSummary } from "@1outres/dsh-bot-core"
import type { JsonDocument, JsonNode } from "../json/reader"
import { isOpId } from "./reference"

/**
 * What the provider takes from op's JSON: names, ids, URLs and the
 * username, read field by field. A value of any other field (a password,
 * a one-time code's seed and current code, a password's history, a
 * reference) is never decoded.
 */

/** The categories bots log in with (`op item list --categories` and `op item get`). */
export const LOGIN_CATEGORIES = ["Login", "Password"] as const
const ITEM_CATEGORIES = ["LOGIN", "PASSWORD"]

export interface OpIdentity {
  readonly subject: string
  readonly label: string
}

export interface OpVault {
  readonly id: string
  readonly name: string
}

/** An item as `op item list` shows it: no fields. */
export interface OpListedItem {
  readonly vaultId: string
  readonly itemId: string
  /** Changes whenever the item does. */
  readonly updatedAt: string
}

/** op's output was not what this provider reads; never quotes it. */
export class OpOutputError extends Error {
  override readonly name = "OpOutputError"
}

const required = (doc: JsonDocument, node: JsonNode | undefined, key: string): string => {
  const value = doc.text(doc.member(node, key))
  if (value === undefined || value === "")
    throw new OpOutputError(`1Password's answer lacks ${key}`)
  return value
}

const optional = (doc: JsonDocument, node: JsonNode | undefined, key: string) => {
  const value = doc.text(doc.member(node, key))
  return value === undefined || value === "" ? undefined : value
}

const opId = (doc: JsonDocument, node: JsonNode | undefined, key: string): string => {
  const id = required(doc, node, key)
  if (!isOpId(id)) throw new OpOutputError(`1Password's answer has a malformed ${key}`)
  return id
}

/** `op whoami`: a service account (its account URL and user id). */
export function identityOf(doc: JsonDocument): OpIdentity {
  const root = doc.root
  if (!doc.isText(doc.member(root, "user_type"), "SERVICE_ACCOUNT")) {
    throw new OpOutputError("the token is not a 1Password service account's")
  }
  const url = required(doc, root, "url")
  const user = required(doc, root, "user_uuid")
  let host: string
  try {
    host = new URL(url).host
  } catch {
    throw new OpOutputError("1Password's answer has a malformed account URL")
  }
  return { subject: `${url}#${user}`, label: `1Password ${host}` }
}

/** `op vault list`. */
export function vaultsOf(doc: JsonDocument): readonly OpVault[] {
  return doc.items(doc.root).map((vault) => ({
    id: opId(doc, vault, "id"),
    name: required(doc, vault, "name"),
  }))
}

/** `op item list --vault <id>`. */
export function listedItemsOf(doc: JsonDocument): readonly OpListedItem[] {
  return doc.items(doc.root).map((item) => ({
    vaultId: opId(doc, doc.member(item, "vault"), "id"),
    itemId: opId(doc, item, "id"),
    updatedAt: required(doc, item, "updated_at"),
  }))
}

const fieldKindOf = (doc: JsonDocument, field: JsonNode): VaultItemField["kind"] | undefined => {
  const purpose = doc.member(field, "purpose")
  if (doc.isText(purpose, "USERNAME")) return "username"
  if (doc.isText(purpose, "PASSWORD")) return "password"
  if (doc.isText(doc.member(field, "type"), "OTP")) return "otp"
  return undefined
}

/**
 * `op item get <id> --vault <id>`: the item without values, or undefined
 * for a category bots do not log in with. Its first username, password
 * (the field whose purpose is PASSWORD, not other concealed ones) and
 * one-time password fields, each only when its id can be referenced.
 */
export function itemOf(doc: JsonDocument): VaultItemSummary | undefined {
  const root = doc.root
  if (!ITEM_CATEGORIES.some((category) => doc.isText(doc.member(root, "category"), category))) {
    return undefined
  }
  const vault = doc.member(root, "vault")
  const fields: VaultItemField[] = []
  let username: string | undefined
  for (const field of doc.items(doc.member(root, "fields"))) {
    const kind = fieldKindOf(doc, field)
    if (kind === undefined || fields.some((each) => each.kind === kind)) continue
    const id = doc.text(doc.member(field, "id"))
    if (id === undefined || !isOpId(id)) continue
    if (kind === "username") {
      username = optional(doc, field, "value")
      if (username === undefined) continue
    }
    fields.push({ id, kind, label: optional(doc, field, "label") ?? kind })
  }
  const websites = doc
    .items(doc.member(root, "urls"))
    .flatMap((url) => optional(doc, url, "href") ?? [])
  const updated = Date.parse(optional(doc, root, "updated_at") ?? "")
  return {
    vaultId: opId(doc, vault, "id"),
    itemId: opId(doc, root, "id"),
    vaultName: required(doc, vault, "name"),
    title: optional(doc, root, "title") ?? "",
    websites,
    ...(username === undefined ? {} : { username }),
    fields,
    ...(Number.isNaN(updated) ? {} : { updatedAt: updated }),
  }
}
