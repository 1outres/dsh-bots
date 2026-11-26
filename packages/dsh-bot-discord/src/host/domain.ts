import { cardRecordSchema, digestRecordSchema } from "./actions/domain"
import { incidentNoticeSchema } from "./incidents/domain"
import { profileRecordSchema } from "./profile/domain"
import { inquiryCardSchema } from "./senders/domain"

export const DISCORD_DOMAIN = {
  name: "dsh_bot_discord",
  version: 5,
  compatibleVersions: [1, 2, 3, 4],
  invalidRecords: "backup-and-skip",
  tables: {
    cards: { valueSchema: cardRecordSchema },
    digests: { valueSchema: digestRecordSchema },
    incidents: { valueSchema: incidentNoticeSchema },
    profiles: { valueSchema: profileRecordSchema },
    inquiry_cards: { valueSchema: inquiryCardSchema },
  },
} as const
