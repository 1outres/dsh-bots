import type { DiscordActions } from "./discord"

/** The DM channel of each allowed user: learned from their messages, else opened once. */
export interface DmDirectory {
  learn(userId: string, channelId: string): void
  /** The DM channels of the users, in order; a user whose DM cannot be opened is left out. */
  channelsOf(users: Iterable<string>): Promise<readonly string[]>
  /** The same, with whose DM each one is. */
  recipientsOf(users: Iterable<string>): Promise<readonly DmRecipient[]>
}

export interface DmRecipient {
  readonly userId: string
  readonly channelId: string
}

export interface DmDirectoryDeps {
  openDm: DiscordActions["openDm"]
  failed(userId: string, error: unknown): void
}

export function createDmDirectory(deps: DmDirectoryDeps): DmDirectory {
  const channels = new Map<string, string>()
  const channelOf = async (userId: string): Promise<string | undefined> => {
    const known = channels.get(userId)
    if (known !== undefined) return known
    try {
      const channelId = await deps.openDm(userId)
      channels.set(userId, channelId)
      return channelId
    } catch (error) {
      deps.failed(userId, error)
      return undefined
    }
  }
  const recipientsOf = async (users: Iterable<string>): Promise<readonly DmRecipient[]> => {
    const found: DmRecipient[] = []
    for (const userId of users) {
      const channelId = await channelOf(userId)
      if (channelId !== undefined) found.push({ userId, channelId })
    }
    return found
  }
  return {
    learn(userId, channelId) {
      channels.set(userId, channelId)
    },
    async channelsOf(users) {
      return (await recipientsOf(users)).map((recipient) => recipient.channelId)
    },
    recipientsOf,
  }
}
