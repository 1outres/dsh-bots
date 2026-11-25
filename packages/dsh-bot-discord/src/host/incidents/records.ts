import type { RecordTable } from "../actions/records"
import { type IncidentNoticeRecord, incidentNoticeKey } from "./domain"

/** A notice within one bot's notices. */
export type IncidentNotice = Omit<IncidentNoticeRecord, "botId">

/** Which of one bot's credential incidents each owner was shown, across connections. */
export interface IncidentNotices {
  shown(incidentId: string, userId: string): boolean
  save(notice: IncidentNotice): Promise<void>
}

export function openIncidentNotices(
  records: RecordTable<IncidentNoticeRecord>,
  botId: string,
): IncidentNotices {
  return {
    shown: (incidentId, userId) =>
      records.get(incidentNoticeKey(botId, incidentId, userId)) !== undefined,
    save: (notice) =>
      records.put(incidentNoticeKey(botId, notice.incidentId, notice.userId), { ...notice, botId }),
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
