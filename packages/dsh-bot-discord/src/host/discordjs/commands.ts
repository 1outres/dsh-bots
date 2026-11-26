import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  type RESTPutAPIApplicationCommandsJSONBody,
} from "discord.js"
import type { DiscordCommandInvocation, DiscordCommandSpec, DiscordGatewayMode } from "../discord"
import { toEmbeds } from "./components"

/** Global chat commands, offered only where the mode puts the home: the bot's DMs, or servers (installed to a server, not to a user). */
export function toCommandsBody(
  commands: readonly DiscordCommandSpec[],
  mode: DiscordGatewayMode,
): RESTPutAPIApplicationCommandsJSONBody {
  return commands.map((command) => ({
    type: ApplicationCommandType.ChatInput,
    name: command.name,
    description: command.description,
    ...(command.descriptionJa === undefined
      ? {}
      : { description_localizations: { ja: command.descriptionJa } }),
    contexts: [mode === "dm" ? InteractionContextType.BotDM : InteractionContextType.Guild],
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
    channelId: interaction.channelId,
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
