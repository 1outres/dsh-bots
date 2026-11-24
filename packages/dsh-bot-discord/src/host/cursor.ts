import { compareSnowflakes } from "./snowflake"

/** The newest message taken from each DM channel: a message at or before it was taken already. */
export interface DmCursor {
  /** Move a channel's position to `messageId`; false when the message is not newer than the position. */
  advance(channelId: string, messageId: string): boolean
  /** Every channel's position, as [channelId, messageId]. */
  positions(): readonly (readonly [string, string])[]
}

export function createDmCursor(): DmCursor {
  const latest = new Map<string, string>()
  return {
    advance(channelId, messageId) {
      const last = latest.get(channelId)
      if (last !== undefined && compareSnowflakes(messageId, last) <= 0) return false
      latest.set(channelId, messageId)
      return true
    },
    positions: () => [...latest],
  }
}
