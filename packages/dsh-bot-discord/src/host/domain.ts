import { cardRecordSchema, digestRecordSchema } from "./actions/domain"
import { incidentNoticeSchema } from "./incidents/domain"

/**
 * What the channel keeps for every bot: where the connector approval messages
 * sit in its approvers' DMs (a new connection edits them instead of posting
 * them again) and which credential incidents each owner was shown. Disposable:
 * a record that no longer parses is set aside and its message posted anew.
 * Version 2 added the `incidents` table; every version 1 unit is a valid
 * version 2 unit, hence `compatibleVersions`.
 */
export const DISCORD_DOMAIN = {
  name: "dsh_bot_discord",
  version: 2,
  compatibleVersions: [1],
  invalidRecords: "backup-and-skip",
  tables: {
    cards: { valueSchema: cardRecordSchema },
    digests: { valueSchema: digestRecordSchema },
    incidents: { valueSchema: incidentNoticeSchema },
  },
} as const
