import type {
  SecretBytes,
  VaultFieldRef,
  VaultItemRef,
  VaultItemSummary,
  VaultSession,
} from "@1outres/dsh-bot-core"
import { type JsonDocument, JsonSyntaxError, readJson } from "./json/reader"
import { type OpEnvironment, opEnvironment } from "./op/environment"
import { OpFailure } from "./op/failure"
import type { OpHome } from "./op/home"
import {
  identityOf,
  itemOf,
  LOGIN_CATEGORIES,
  listedItemsOf,
  OpOutputError,
  vaultsOf,
} from "./op/items"
import { isOpId, secretReference } from "./op/reference"
import { type OpCommand, runOp } from "./op/runner"

/** How long a listing of the items answers the owner's searches before op is asked again. */
export const LIST_TTL_MS = 30_000
/** op processes one session runs at once. */
export const MAX_CONCURRENT_COMMANDS = 4

const KIB = 1024
const MIB = 1024 * KIB

export interface OnePasswordSessionDeps {
  readonly binary: string
  /** The service account token's bytes, the session's own: wiped on close. */
  readonly token: Uint8Array
  readonly home: OpHome
  secret(bytes: Uint8Array): SecretBytes
  now(): number
}

const command = (
  name: string,
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number,
): OpCommand => ({ name, args, timeoutMs, maxOutputBytes })

const COMMANDS = {
  whoami: () => command("whoami", ["whoami", "--format", "json"], 30_000, 64 * KIB),
  vaults: () => command("vault list", ["vault", "list", "--format", "json"], 30_000, 4 * MIB),
  items: (vaultId: string) =>
    command(
      "item list",
      [
        "item",
        "list",
        "--vault",
        vaultId,
        "--categories",
        LOGIN_CATEGORIES.join(","),
        "--format",
        "json",
      ],
      60_000,
      16 * MIB,
    ),
  item: (ref: VaultItemRef) =>
    command(
      "item get",
      ["item", "get", ref.itemId, "--vault", ref.vaultId, "--format", "json"],
      30_000,
      4 * MIB,
    ),
  read: (ref: VaultFieldRef) =>
    command("read", ["read", "--no-newline", secretReference(ref)], 30_000, 64 * KIB),
}

function withJson<T>(bytes: Uint8Array, read: (doc: JsonDocument) => T): T {
  let doc: JsonDocument
  try {
    doc = readJson(bytes)
  } catch (error) {
    bytes.fill(0)
    if (error instanceof JsonSyntaxError) throw new OpOutputError("1Password's answer is not JSON")
    throw error
  }
  try {
    return read(doc)
  } finally {
    doc.wipe()
  }
}

function limiter(slots: number) {
  let free = slots
  const waiting: (() => void)[] = []
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (free === 0) await new Promise<void>((resolve) => waiting.push(resolve))
    else free--
    try {
      return await work()
    } finally {
      const next = waiting.shift()
      if (next === undefined) free++
      else next()
    }
  }
}

const gone = (error: unknown) =>
  error instanceof OpFailure && (error.reason === "not-found" || error.reason === "forbidden")

/**
 * One connected service account. It keeps no value: only item metadata
 * (names, field ids, usernames, URLs), by the item's `updated_at`, so a
 * listing asks op for the items that changed (each `item get` is one of the
 * account's rate-limited reads), and a listing answers searches for
 * {@link LIST_TTL_MS}. Every value is read for one `reveal` and handed over.
 */
export function createOnePasswordSession(deps: OnePasswordSessionDeps): VaultSession {
  const closing = new AbortController()
  const limit = limiter(MAX_CONCURRENT_COMMANDS)
  const metadata = new Map<
    string,
    { readonly updatedAt: string; readonly item: VaultItemSummary }
  >()
  let listing:
    | { readonly at: number; readonly items: Promise<readonly VaultItemSummary[]> }
    | undefined
  let closed = false

  const environment = (): OpEnvironment => opEnvironment(deps.token, deps.home)
  const run = (cmd: OpCommand, signal: AbortSignal): Promise<Uint8Array> => {
    if (closed) return Promise.reject(new Error("the 1Password session is closed"))
    return limit(() =>
      runOp(deps.binary, cmd, environment(), AbortSignal.any([signal, closing.signal])),
    )
  }
  const keyOf = (ref: VaultItemRef) => `${ref.vaultId}/${ref.itemId}`

  const item = async (ref: VaultItemRef, signal: AbortSignal) => {
    if (!isOpId(ref.vaultId) || !isOpId(ref.itemId)) return undefined
    let bytes: Uint8Array
    try {
      bytes = await run(COMMANDS.item(ref), signal)
    } catch (error) {
      if (gone(error)) return undefined
      throw error
    }
    const found = withJson(bytes, itemOf)
    if (found === undefined || found.vaultId !== ref.vaultId || found.itemId !== ref.itemId) {
      metadata.delete(keyOf(ref))
      return undefined
    }
    return found
  }

  const list = async (signal: AbortSignal): Promise<readonly VaultItemSummary[]> => {
    const vaults = withJson(await run(COMMANDS.vaults(), signal), vaultsOf)
    const listed = (
      await Promise.all(
        vaults.map(async (vault) =>
          withJson(await run(COMMANDS.items(vault.id), signal), listedItemsOf),
        ),
      )
    ).flat()
    const items = await Promise.all(
      listed.map(async (entry) => {
        const key = keyOf(entry)
        const known = metadata.get(key)
        if (known?.updatedAt === entry.updatedAt) return known.item
        const found = await item(entry, signal)
        if (found === undefined) metadata.delete(key)
        else metadata.set(key, { updatedAt: entry.updatedAt, item: found })
        return found
      }),
    )
    const present = new Set(listed.map(keyOf))
    for (const key of [...metadata.keys()]) if (!present.has(key)) metadata.delete(key)
    return items.filter((each): each is VaultItemSummary => each !== undefined)
  }

  return {
    async identify(signal) {
      return withJson(await run(COMMANDS.whoami(), signal), identityOf)
    },
    listItems(signal) {
      const now = deps.now()
      if (listing === undefined || now - listing.at >= LIST_TTL_MS) {
        const items = list(signal)
        const entry = { at: now, items }
        listing = entry
        items.catch(() => {
          if (listing === entry) listing = undefined
        })
      }
      return listing.items
    },
    item,
    async reveal(ref, signal) {
      if (ref.kind !== "password" && ref.kind !== "otp") {
        throw new Error(`1Password hands out no ${String(ref.kind)}`)
      }
      const bytes = await run(COMMANDS.read(ref), signal)
      if (bytes.length === 0) throw new Error("the 1Password field is empty")
      return deps.secret(bytes)
    },
    async close() {
      if (closed) return
      closed = true
      closing.abort()
      deps.token.fill(0)
      metadata.clear()
      listing = undefined
      await deps.home.remove()
    },
  }
}
