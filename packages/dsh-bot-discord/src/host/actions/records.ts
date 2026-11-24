import { type CardRecord, cardKey, type DigestRecord, digestKey } from "./domain"

/** The slice of a storage-domain table the records use. */
export interface RecordTable<V> {
  get(key: string): V | undefined
  entries(): Iterable<[string, V]>
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<unknown>
}

export interface ApprovalTables {
  readonly cards: RecordTable<CardRecord>
  readonly digests: RecordTable<DigestRecord>
}

/** A record within one bot's records. */
export type ApprovalCard = Omit<CardRecord, "botId">
export type ApprovalDigest = Omit<DigestRecord, "botId">

/** Where one bot's approval messages sit: its cards per action and approver, and each approver's list. */
export interface ApprovalRecords {
  cards(): readonly ApprovalCard[]
  card(actionId: string, userId: string): ApprovalCard | undefined
  saveCard(card: ApprovalCard): Promise<void>
  forgetCard(actionId: string, userId: string): Promise<void>
  digests(): readonly ApprovalDigest[]
  digest(userId: string): ApprovalDigest | undefined
  saveDigest(digest: ApprovalDigest): Promise<void>
  forgetDigest(userId: string): Promise<void>
}

export function openApprovalRecords(tables: ApprovalTables, botId: string): ApprovalRecords {
  const own = <V extends { readonly botId: string }>(table: RecordTable<V>): V[] =>
    [...table.entries()].map(([, value]) => value).filter((value) => value.botId === botId)
  return {
    cards: () => own(tables.cards),
    card: (actionId, userId) => tables.cards.get(cardKey(botId, actionId, userId)),
    saveCard: (card) =>
      tables.cards.put(cardKey(botId, card.actionId, card.userId), { ...card, botId }),
    async forgetCard(actionId, userId) {
      await tables.cards.delete(cardKey(botId, actionId, userId))
    },
    digests: () => own(tables.digests),
    digest: (userId) => tables.digests.get(digestKey(botId, userId)),
    saveDigest: (digest) =>
      tables.digests.put(digestKey(botId, digest.userId), { ...digest, botId }),
    async forgetDigest(userId) {
      await tables.digests.delete(digestKey(botId, userId))
    },
  }
}

/** Forget the records of bots `keep` refuses (deleted bots). */
export async function purgeApprovalRecords(
  tables: ApprovalTables,
  keep: (botId: string) => boolean,
): Promise<void> {
  for (const records of [tables.cards, tables.digests] as const) {
    for (const [key, value] of [...records.entries()]) {
      if (!keep(value.botId)) await records.delete(key)
    }
  }
}
