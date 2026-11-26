import type { BotChannelSettingsUpgrade, BotChannelStoredSettings } from "@1outres/dsh-bot-core"
import { DM_HOME } from "./home"

const listOf = (value: string | readonly string[] | undefined): readonly string[] =>
  Array.isArray(value) ? value : []

export function upgradeDiscordSettings(
  stored: BotChannelStoredSettings,
): BotChannelSettingsUpgrade {
  if (stored.version !== 1) {
    throw new Error(`Discord settings of version ${stored.version} have no upgrade`)
  }
  const { users: storedUsers, approvers: storedOwners, ...rest } = stored.values
  const users = listOf(storedUsers)
  const owners = listOf(storedOwners)
  const owner = owners.find((id) => users.includes(id)) ?? owners[0] ?? users[0]
  const dropped = [...new Set([...owners, ...users])].filter((id) => id !== owner)
  return {
    values: { ...rest, home: DM_HOME, approvers: owner === undefined ? [] : [owner] },
    notes:
      dropped.length === 0
        ? []
        : [
            `the home is now direct messages with ${owner}; no longer allowed or owners: ${dropped.join(", ")}`,
          ],
  }
}
