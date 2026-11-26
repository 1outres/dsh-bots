import { compareSnowflakes } from "./snowflake"

export interface DmCursor {
  advance(channelId: string, messageId: string): boolean
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
