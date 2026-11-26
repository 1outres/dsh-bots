import type { RecordTable } from "../actions/records"
import type { ProfileRecord } from "./domain"

export interface AppliedProfile {
  readonly username?: string
  readonly avatar?: string
}

export interface ProfileRecords {
  applied(userId: string): AppliedProfile
  save(userId: string, applied: AppliedProfile): Promise<void>
}

export function openProfileRecords(
  records: RecordTable<ProfileRecord>,
  botId: string,
): ProfileRecords {
  return {
    applied(userId) {
      const record = records.get(botId)
      if (record === undefined || record.userId !== userId) return {}
      return {
        ...(record.username === undefined ? {} : { username: record.username }),
        ...(record.avatar === undefined ? {} : { avatar: record.avatar }),
      }
    },
    save: (userId, applied) => records.put(botId, { botId, userId, ...applied }),
  }
}

export async function purgeProfileRecords(
  records: RecordTable<ProfileRecord>,
  keep: (botId: string) => boolean,
): Promise<void> {
  for (const [key, value] of [...records.entries()]) {
    if (!keep(value.botId)) await records.delete(key)
  }
}
