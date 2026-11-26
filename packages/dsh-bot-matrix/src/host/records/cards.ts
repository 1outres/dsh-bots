import { type CardRecord, cardKey, type DigestRecord, type MatrixTables } from "./domain"

export type ActionCard = Omit<CardRecord, "botId">
export type ActionDigest = Omit<DigestRecord, "botId">

export interface ActionRecords {
  cards(): readonly ActionCard[]
  card(actionId: string): ActionCard | undefined
  byEvent(eventId: string): ActionCard | undefined
  saveCard(card: ActionCard): Promise<void>
  forgetCard(actionId: string): Promise<void>
  digest(): ActionDigest | undefined
  saveDigest(digest: ActionDigest): Promise<void>
  forgetDigest(): Promise<void>
}

export function openActionRecords(
  tables: Pick<MatrixTables, "cards" | "digests">,
  botId: string,
): ActionRecords {
  const cards = () =>
    [...tables.cards.entries()].map(([, value]) => value).filter((value) => value.botId === botId)
  return {
    cards,
    card: (actionId) => tables.cards.get(cardKey(botId, actionId)),
    byEvent: (eventId) => cards().find((card) => card.eventId === eventId),
    saveCard: (card) => tables.cards.put(cardKey(botId, card.actionId), { ...card, botId }),
    async forgetCard(actionId) {
      await tables.cards.delete(cardKey(botId, actionId))
    },
    digest: () => tables.digests.get(botId),
    saveDigest: (digest) => tables.digests.put(botId, { ...digest, botId }),
    async forgetDigest() {
      await tables.digests.delete(botId)
    },
  }
}
