import { cardRecordSchema, digestRecordSchema } from "./actions/domain"
import { incidentNoticeSchema } from "./incidents/domain"

export const DISCORD_DOMAIN = {
  name: "dsh_bot_discord",
  version: 3,
  compatibleVersions: [1, 2],
  invalidRecords: "backup-and-skip",
  tables: {
    cards: { valueSchema: cardRecordSchema },
    digests: { valueSchema: digestRecordSchema },
    incidents: { valueSchema: incidentNoticeSchema },
  },
} as const
