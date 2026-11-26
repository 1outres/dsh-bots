import type { RecordTable } from "../actions/records"
import { type InquiryCardRecord, inquiryCardKey } from "./domain"

export type InquiryCard = Omit<InquiryCardRecord, "botId">

export interface InquiryCards {
  all(): readonly InquiryCard[]
  card(inquiryId: string): InquiryCard | undefined
  save(card: InquiryCard): Promise<void>
  forget(inquiryId: string): Promise<void>
}

export async function adoptInquiryCards(
  records: RecordTable<InquiryCardRecord>,
  botId: string,
  homeChannelId: string,
): Promise<void> {
  for (const [key, value] of [...records.entries()]) {
    if (value.botId !== botId) continue
    if (value.channelId !== homeChannelId) await records.delete(key)
  }
}

export function openInquiryCards(
  records: RecordTable<InquiryCardRecord>,
  botId: string,
): InquiryCards {
  return {
    all: () =>
      [...records.entries()].map(([, value]) => value).filter((value) => value.botId === botId),
    card: (inquiryId) => records.get(inquiryCardKey(botId, inquiryId)),
    save: (card) => records.put(inquiryCardKey(botId, card.inquiryId), { ...card, botId }),
    async forget(inquiryId) {
      await records.delete(inquiryCardKey(botId, inquiryId))
    },
  }
}

export async function purgeInquiryCards(
  records: RecordTable<InquiryCardRecord>,
  keep: (botId: string) => boolean,
): Promise<void> {
  for (const [key, value] of [...records.entries()]) {
    if (!keep(value.botId)) await records.delete(key)
  }
}
