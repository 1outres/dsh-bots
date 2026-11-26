import {
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  type APIModalInteractionResponseCallbackData,
  ButtonStyle,
  ComponentType,
  type InteractionUpdateOptions,
  type MessageComponentInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
  TextInputStyle,
} from "discord.js"
import type {
  DiscordButtonStyle,
  DiscordComponentPress,
  DiscordComponentRow,
  DiscordEmbed,
  DiscordMessageEdit,
  DiscordModalSubmit,
  DiscordTextModal,
} from "../discord"

const BUTTON_STYLES: Readonly<
  Record<
    DiscordButtonStyle,
    ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger
  >
> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
}

export function toActionRows(
  rows: readonly DiscordComponentRow[],
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  return rows.map((row) => ({
    type: ComponentType.ActionRow,
    components: row.map(
      (component): APIComponentInMessageActionRow =>
        component.kind === "button"
          ? {
              type: ComponentType.Button,
              custom_id: component.customId,
              label: component.label,
              style: BUTTON_STYLES[component.style],
              disabled: component.disabled,
            }
          : {
              type: ComponentType.StringSelect,
              custom_id: component.customId,
              ...(component.placeholder === undefined
                ? {}
                : { placeholder: component.placeholder }),
              min_values: component.minValues,
              max_values: component.maxValues,
              disabled: component.disabled,
              options: component.options.map((option) => ({
                value: option.value,
                label: option.label,
                ...(option.description === undefined ? {} : { description: option.description }),
                default: option.selected,
              })),
            },
    ),
  }))
}

export function toEmbeds(embeds: readonly DiscordEmbed[]): APIEmbed[] {
  return embeds.map((embed) => ({
    ...(embed.title === undefined ? {} : { title: embed.title }),
    ...(embed.description === undefined ? {} : { description: embed.description }),
  }))
}

export function toEditOptions(message: DiscordMessageEdit): InteractionUpdateOptions {
  return {
    content: message.content,
    ...(message.embeds === undefined ? {} : { embeds: toEmbeds(message.embeds) }),
    components: toActionRows(message.components),
    allowedMentions: { parse: [] },
  }
}

export function toModal(modal: DiscordTextModal): APIModalInteractionResponseCallbackData {
  const { input } = modal
  return {
    custom_id: modal.customId,
    title: modal.title,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            custom_id: modal.customId,
            label: input.label,
            style: TextInputStyle.Paragraph,
            required: input.required,
            max_length: input.maxLength,
            ...(input.value === undefined || input.value === "" ? {} : { value: input.value }),
            ...(input.placeholder === undefined ? {} : { placeholder: input.placeholder }),
          },
        ],
      },
    ],
  }
}

const ephemeral = (content: string, isEphemeral: boolean) => ({
  content,
  allowedMentions: { parse: [] as [] },
  ...(isEphemeral ? { flags: MessageFlags.Ephemeral as const } : {}),
})

export function toComponentPress(interaction: MessageComponentInteraction): DiscordComponentPress {
  return {
    customId: interaction.customId,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    locale: interaction.locale,
    channelId: interaction.channelId,
    messageId: interaction.message.id,
    values: interaction.isStringSelectMenu() ? [...interaction.values] : [],
    async update(message) {
      await interaction.update(toEditOptions(message))
    },
    async reply(response) {
      await interaction.reply(ephemeral(response.content, response.ephemeral))
    },
    async showModal(modal) {
      await interaction.showModal(toModal(modal))
    },
  }
}

export function toModalSubmit(interaction: ModalSubmitInteraction): DiscordModalSubmit {
  const channelId = interaction.channelId
  if (channelId === null) throw new Error("a modal submit without a channel")
  return {
    customId: interaction.customId,
    userId: interaction.user.id,
    guildId: interaction.guildId,
    locale: interaction.locale,
    channelId,
    messageId: interaction.message?.id ?? null,
    value: interaction.fields.getTextInputValue(interaction.customId),
    async update(message) {
      if (!interaction.isFromMessage()) throw new Error("the modal was not opened from a message")
      await interaction.update(toEditOptions(message))
    },
    async reply(response) {
      await interaction.reply(ephemeral(response.content, response.ephemeral))
    },
  }
}
