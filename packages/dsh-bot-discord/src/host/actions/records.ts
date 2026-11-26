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

/** Where one bot's approval messages sit at its home: a card per action, and the list. */
export interface ApprovalRecords {
  cards(): readonly ApprovalCard[]
  card(actionId: string): ApprovalCard | undefined
  saveCard(card: ApprovalCard): Promise<void>
  forgetCard(actionId: string): Promise<void>
  digest(): ApprovalDigest | undefined
  saveDigest(digest: ApprovalDigest): Promise<void>
  forgetDigest(): Promise<void>
}

/**
 * Keep, under their keys, the bot's records that sit at its home channel, and
 * forget the others: those of an earlier home, of another Discord bot, and
 * the version 2 records of approvers' DMs that are not the home.
 */
export async function adoptApprovalRecords(
  tables: ApprovalTables,
  botId: string,
  homeChannelId: string,
): Promise<void> {
  const adopt = async <V extends { readonly botId: string; readonly channelId: string }>(
    records: RecordTable<V>,
    keyOf: (value: V) => string,
  ) => {
    for (const [key, value] of [...records.entries()]) {
      if (value.botId !== botId) continue
      const canonical = keyOf(value)
      if (
        value.channelId !== homeChannelId ||
        (key !== canonical && records.get(canonical) !== undefined)
      ) {
        await records.delete(key)
      } else if (key !== canonical) {
        await records.delete(key)
        await records.put(canonical, value)
      }
    }
  }
  await adopt(tables.cards, (card) => cardKey(botId, card.actionId))
  await adopt(tables.digests, () => digestKey(botId))
}

export function openApprovalRecords(tables: ApprovalTables, botId: string): ApprovalRecords {
  return {
    cards: () =>
      [...tables.cards.entries()]
        .map(([, value]) => value)
        .filter((value) => value.botId === botId),
    card: (actionId) => tables.cards.get(cardKey(botId, actionId)),
    saveCard: (card) => tables.cards.put(cardKey(botId, card.actionId), { ...card, botId }),
    async forgetCard(actionId) {
      await tables.cards.delete(cardKey(botId, actionId))
    },
    digest: () => tables.digests.get(digestKey(botId)),
    saveDigest: (digest) => tables.digests.put(digestKey(botId), { ...digest, botId }),
    async forgetDigest() {
      await tables.digests.delete(digestKey(botId))
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
