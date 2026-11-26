import { cardRecordSchema, digestRecordSchema } from "./actions/domain"
import { incidentNoticeSchema } from "./incidents/domain"

/**
 * What the channel keeps for every bot: where the connector approval messages
 * sit at its home (a new connection edits them instead of posting them
 * again) and which credential incidents the home was shown. Disposable: a
 * record that no longer parses is set aside and its message posted anew.
 * Version 2 added the `incidents` table; version 3 keeps them per home
 * instead of per person. Version 1 and 2 units parse as version 3 (their
 * `userId` is dropped) and each connection adopts those of its home under
 * the new keys (`adoptApprovalRecords`, `adoptIncidentNotices`).
 */
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
