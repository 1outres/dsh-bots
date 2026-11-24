import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  type RESTPutAPIApplicationCommandsJSONBody,
} from "discord.js"
import type { DiscordCommandInvocation, DiscordCommandSpec } from "../discord"
import { toEmbeds } from "./components"

/** Global chat commands, offered only in the bot's DMs (installed to a server, not to a user). */
export function toCommandsBody(
  commands: readonly DiscordCommandSpec[],
): RESTPutAPIApplicationCommandsJSONBody {
  return commands.map((command) => ({
    type: ApplicationCommandType.ChatInput,
    name: command.name,
    description: command.description,
    ...(command.descriptionJa === undefined
      ? {}
      : { description_localizations: { ja: command.descriptionJa } }),
    contexts: [InteractionContextType.BotDM],
    integration_types: [ApplicationIntegrationType.GuildInstall],
  }))
}

export function toCommandInvocation(
  interaction: ChatInputCommandInteraction,
): DiscordCommandInvocation {
  return {
    name: interaction.commandName,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    locale: interaction.locale,
    async respond(response) {
      await interaction.reply({
        ...(response.content === "" ? {} : { content: response.content }),
        ...(response.embeds === undefined ? {} : { embeds: toEmbeds(response.embeds) }),
        allowedMentions: { parse: [] },
        ...(response.ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
      })
    },
  }
}
