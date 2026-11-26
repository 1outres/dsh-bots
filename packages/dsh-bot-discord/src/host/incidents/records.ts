import type { RecordTable } from "../actions/records"
import { type IncidentNoticeRecord, incidentNoticeKey } from "./domain"

/** A notice within one bot's notices. */
export type IncidentNotice = Omit<IncidentNoticeRecord, "botId">

/** Which of one bot's credential incidents its home was shown, across connections. */
export interface IncidentNotices {
  shown(incidentId: string): boolean
  save(notice: IncidentNotice): Promise<void>
}

/** Keep the bot's notices shown at its home channel, under their keys; forget the others. */
export async function adoptIncidentNotices(
  records: RecordTable<IncidentNoticeRecord>,
  botId: string,
  homeChannelId: string,
): Promise<void> {
  for (const [key, value] of [...records.entries()]) {
    if (value.botId !== botId) continue
    const canonical = incidentNoticeKey(botId, value.incidentId)
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

export function openIncidentNotices(
  records: RecordTable<IncidentNoticeRecord>,
  botId: string,
): IncidentNotices {
  return {
    shown: (incidentId) => records.get(incidentNoticeKey(botId, incidentId)) !== undefined,
    save: (notice) =>
      records.put(incidentNoticeKey(botId, notice.incidentId), { ...notice, botId }),
  }
}

/** Forget the notices of bots `keep` refuses (deleted bots). */
export async function purgeIncidentNotices(
  records: RecordTable<IncidentNoticeRecord>,
  keep: (botId: string) => boolean,
): Promise<void> {
  for (const [key, value] of [...records.entries()]) {
    if (!keep(value.botId)) await records.delete(key)
  }
}
