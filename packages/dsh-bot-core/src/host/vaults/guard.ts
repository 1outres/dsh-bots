import type {
  VaultIncidentOutcome,
  VaultIncidentSource,
  VaultIncidentView,
  VaultSecretKind,
} from "../../shared/vaults"
import { MIN_GUARDED_LENGTH } from "../../shared/vaults"
import { wipeBytes } from "../../vault-bytes"
import type { VaultFingerprintRecord, VaultIncidentRecord } from "./domain"
import {
  type DigestCache,
  findPrints,
  type GuardDigest,
  type GuardKeys,
  indexPrints,
  type OwnedPrint,
  type PrintMatch,
  printsOf,
} from "./fingerprints"
import { readingsOf } from "./normalize"
import type { VaultStore } from "./store"

export interface VaultGuardDeps {
  store: Pick<VaultStore, "grant" | "fingerprints" | "putFingerprint" | "recordIncident">
  keys(): Promise<GuardKeys>
  digest: GuardDigest
  report(incident: VaultIncidentView): void
  newId(): string
  now(): number
  readonly scanLimit: number
}

export interface GuardSubject {
  readonly botId: string
  readonly sessionId?: string
  readonly tool?: string
}

export interface GuardFinding {
  readonly grantId: string
  readonly kind: VaultSecretKind
  readonly label: string
}

export type GuardScan<T> =
  | { readonly changed: false }
  | {
      readonly changed: true
      readonly redacted: T
      readonly findings: readonly GuardFinding[]
      readonly cut: boolean
    }

export class GuardStaleError extends Error {
  override readonly name = "GuardStaleError"
}

export interface VaultGuard {
  fingerprint(
    botId: string,
    grantId: string,
    kind: VaultSecretKind,
    bytes: Uint8Array,
  ): Promise<void>
  guards(botId: string): boolean
  keyId(): string | undefined
  scan<T>(botId: string, value: T): Promise<GuardScan<T>>
  record(
    subject: GuardSubject,
    source: VaultIncidentSource,
    outcome: VaultIncidentOutcome,
    findings: readonly GuardFinding[],
  ): Promise<readonly VaultIncidentView[]>
  shield<T>(subject: GuardSubject, source: VaultIncidentSource, value: T): Promise<T>
}

export const withheldText = (finding: GuardFinding) =>
  `[withheld: secret of ${finding.label} (${finding.kind})]`

const CUT_TEXT = "[withheld: too long for the vault guard to check]"

export const STALE_REASON =
  "the vault guard's key changed since this bot's logins were fingerprinted; the owner must fingerprint them again in the bot's Logins settings"

export function incidentView(record: VaultIncidentRecord): VaultIncidentView {
  return record
}

const isImageBlock = (value: object) => (value as { readonly type?: unknown }).type === "image"

const BLOCK_LISTS = new Set(["content", "feedback"])
const IMAGE_DATA = "data"

export function createVaultGuard(deps: VaultGuardDeps): VaultGuard {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let knownKeyId: string | undefined
  const keys = async () => {
    const loaded = await deps.keys()
    knownKeyId = loaded.id
    return loaded
  }
  const usable = (botId: string) =>
    deps.store.fingerprints(botId).filter((record) => record.prints.length > 0)
  const labelOf = (botId: string, record: VaultFingerprintRecord) =>
    deps.store.grant(botId, record.grantId)?.label ?? record.label

  const guard: VaultGuard = {
    async fingerprint(botId, grantId, kind, bytes) {
      const current = await keys()
      const grant = deps.store.grant(botId, grantId)
      if (grant === undefined) return
      const prints = await printsOf(bytes, current, deps.digest)
      await deps.store.putFingerprint({
        botId,
        grantId,
        kind,
        label: grant.label,
        keyId: current.id,
        state: prints.length === 0 ? "short" : "fingerprinted",
        prints: [...prints],
        at: deps.now(),
      })
    },
    guards: (botId) => usable(botId).length > 0,
    keyId: () => knownKeyId,
    async scan<T>(botId: string, value: T): Promise<GuardScan<T>> {
      const records = usable(botId)
      if (records.length === 0) return { changed: false }
      const current = await keys()
      if (records.some((record) => record.revokedAt === undefined && record.keyId !== current.id)) {
        throw new GuardStaleError(STALE_REASON)
      }
      const owned = new Map<string, VaultFingerprintRecord>()
      const prints: OwnedPrint[] = []
      for (const record of records) {
        if (record.keyId !== current.id) continue
        owned.set(`${record.grantId}:${record.kind}`, record)
        for (const print of record.prints)
          prints.push({ ...print, grantId: record.grantId, kind: record.kind })
      }
      const index = indexPrints(prints)
      const findings = new Map<string, GuardFinding>()
      const cache: DigestCache = new Map()
      let left = deps.scanLimit
      let cut = false
      let changed = false
      const finding = (print: OwnedPrint): GuardFinding => {
        const key = `${print.grantId}:${print.kind}`
        const record = owned.get(key) as VaultFingerprintRecord
        const found = { grantId: print.grantId, kind: record.kind, label: labelOf(botId, record) }
        findings.set(key, found)
        return found
      }
      const matchesIn = async (text: string): Promise<readonly PrintMatch[]> => {
        const bytes = encoder.encode(text)
        try {
          left -= bytes.length
          return await findPrints(bytes, index, current, deps.digest, cache)
        } finally {
          wipeBytes(bytes)
        }
      }
      const redactText = async (text: string): Promise<string> => {
        const bytes = encoder.encode(text)
        let read = text
        let rest = false
        if (bytes.length > left) {
          read = decoder.decode(bytes.subarray(0, Math.max(left, 0))).replace(/\uFFFD$/u, "")
          rest = true
        }
        wipeBytes(bytes)
        const matches = await matchesIn(read)
        let out = read
        if (matches.length > 0) {
          const readBytes = encoder.encode(read)
          const parts: string[] = []
          let at = 0
          let end = 0
          for (const match of matches) {
            if (match.start < end) continue
            parts.push(
              decoder.decode(readBytes.subarray(at, match.start)),
              withheldText(finding(match.print)),
            )
            at = match.end
            end = match.end
          }
          parts.push(decoder.decode(readBytes.subarray(at)))
          wipeBytes(readBytes)
          out = parts.join("")
        }
        for (const reading of readingsOf(read)) {
          if (left <= 0) {
            rest = true
            out = ""
            break
          }
          const hidden = await matchesIn(reading)
          if (hidden.length > 0) {
            out = [...new Set(hidden.map((match) => withheldText(finding(match.print))))].join(" ")
            break
          }
        }
        if (rest) {
          cut = true
          out = `${out}${CUT_TEXT}`
        }
        if (out !== text) changed = true
        return out
      }
      const walk = async (item: unknown, blocks = false): Promise<unknown> => {
        if (typeof item === "string") return redactText(item)
        if (typeof item === "number") {
          const text = String(item)
          if (text.length < MIN_GUARDED_LENGTH) return item
          const redacted = await redactText(text)
          return redacted === text ? item : redacted
        }
        if (Array.isArray(item)) {
          const items: unknown[] = []
          for (const each of item) items.push(await walk(each, blocks))
          return items
        }
        if (typeof item === "object" && item !== null) {
          const image = blocks && isImageBlock(item)
          const entries: [string, unknown][] = []
          for (const [key, each] of Object.entries(item)) {
            entries.push([
              await redactText(key),
              image && key === IMAGE_DATA ? each : await walk(each, BLOCK_LISTS.has(key)),
            ])
          }
          return Object.fromEntries(entries)
        }
        return item
      }
      const redacted = (await walk(value)) as T
      if (!changed) return { changed: false }
      return { changed: true, redacted, findings: [...findings.values()], cut }
    },
    async record(subject, source, outcome, findings) {
      const views: VaultIncidentView[] = []
      for (const found of findings) {
        const stored = await deps.store.recordIncident({
          id: deps.newId(),
          botId: subject.botId,
          ...(subject.sessionId === undefined ? {} : { sessionId: subject.sessionId }),
          at: deps.now(),
          source,
          ...(subject.tool === undefined ? {} : { tool: subject.tool }),
          grantId: found.grantId,
          label: found.label,
          kind: found.kind,
          outcome,
        })
        views.push(incidentView(stored))
      }
      for (const view of views) deps.report(view)
      return views
    },
    async shield(subject, source, value) {
      if (usable(subject.botId).length === 0) return value
      const scan = await guard.scan(subject.botId, value)
      if (!scan.changed) return value
      if (scan.findings.length > 0) await guard.record(subject, source, "redacted", scan.findings)
      return scan.redacted
    },
  }
  return guard
}
