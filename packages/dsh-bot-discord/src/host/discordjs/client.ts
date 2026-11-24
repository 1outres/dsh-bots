import {
  ChannelType,
  Client,
  type ClientOptions,
  type DMChannel,
  Events,
  GatewayDispatchEvents,
  type GatewayReadyDispatchData,
  type PartialDMChannel,
  Routes,
} from "discord.js"
import type {
  DiscordClient,
  DiscordClientEvents,
  DiscordFailure,
  OpenDiscordClient,
} from "../discord"
import { MESSAGES_PAGE_LIMIT } from "../discord"
import { toCommandInvocation, toCommandsBody } from "./commands"
import { toComponentPress, toEditOptions, toModalSubmit } from "./components"
import { closeFailure, isUnreachable, loginFailure, pinRefusal } from "./failures"
import { toDiscordAccount, toDiscordMessage, toMessageOptions } from "./messages"
import { clientOptions } from "./options"

export interface DiscordJsDeps {
  warn(message: string): void
  create(options: ClientOptions): Client
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Serve {@link DiscordClient} with a new discord.js client, logged in with
 * `token`. discord.js keeps the Gateway session (heartbeats, resume,
 * reconnects) and REST (rate limits, retries).
 */
export function openDiscordJsClient(
  token: string,
  events: DiscordClientEvents,
  deps: DiscordJsDeps,
): DiscordClient {
  let stopped = false
  let applicationId: string | undefined
  const client = deps.create(clientOptions(() => stopped))
  const stop = async () => {
    stopped = true
    await client.destroy()
  }
  const fail = (failure: DiscordFailure) => {
    if (stopped) return
    void stop()
      .catch((error: unknown) =>
        deps.warn(`bot-discord: could not stop a client: ${messageOf(error)}`),
      )
      .then(() => events.failed(failure))
  }

  client.ws.on(GatewayDispatchEvents.Ready, (data: GatewayReadyDispatchData) => {
    applicationId = data.application.id
    if (!stopped) events.ready(toDiscordAccount(data.user))
  })
  client.on(Events.ShardResume, () => {
    if (!stopped) events.resumed()
  })
  client.on(Events.ShardReconnecting, () => {
    if (!stopped) events.reconnecting()
  })
  client.on(Events.ShardDisconnect, ({ code }) => fail(closeFailure(code)))
  client.on(Events.MessageCreate, (message) => {
    if (!stopped) events.message(toDiscordMessage(message))
  })
  client.on(Events.InteractionCreate, (interaction) => {
    if (stopped) return
    if (interaction.isChatInputCommand()) events.command(toCommandInvocation(interaction))
    else if (interaction.isButton() || interaction.isStringSelectMenu())
      events.component(toComponentPress(interaction))
    else if (interaction.isModalSubmit()) events.modal(toModalSubmit(interaction))
  })
  client.on(Events.ShardError, (error) => {
    if (!stopped) deps.warn(`bot-discord: Gateway connection error: ${error.message}`)
  })
  client.on(Events.Error, (error) => {
    if (!stopped) deps.warn(`bot-discord: Discord client error: ${error.message}`)
  })

  const dm = async (channelId: string): Promise<DMChannel | PartialDMChannel> => {
    const channel = await client.channels.fetch(channelId)
    if (channel?.type !== ChannelType.DM) {
      throw new Error(`Discord channel ${channelId} is not a direct message`)
    }
    return channel
  }

  client.login(token).then(
    () => {},
    (error: unknown) => fail(loginFailure(error)),
  )

  return {
    async openDm(userId) {
      return (await client.users.createDM(userId)).id
    },
    async send(channelId, message) {
      return (await (await dm(channelId)).send(toMessageOptions(message))).id
    },
    async edit(channelId, messageId, message) {
      const { content, embeds, components } = toEditOptions(message)
      try {
        await (await dm(channelId)).messages.edit(messageId, {
          content,
          ...(embeds === undefined ? {} : { embeds }),
          components,
          allowedMentions: { parse: [] },
        })
        return "edited"
      } catch (error) {
        if (isUnreachable(error)) return "missing"
        throw error
      }
    },
    async remove(channelId, messageId) {
      try {
        await (await dm(channelId)).messages.delete(messageId)
        return "removed"
      } catch (error) {
        if (isUnreachable(error)) return "missing"
        throw error
      }
    },
    async pin(channelId, messageId) {
      try {
        await (await dm(channelId)).messages.pin(messageId)
        return "pinned"
      } catch (error) {
        const refusal = pinRefusal(error)
        if (refusal !== undefined) return refusal
        if (isUnreachable(error)) return "missing"
        throw error
      }
    },
    async react(channelId, messageId, emoji) {
      await (await dm(channelId)).messages.react(messageId, emoji)
    },
    async typing(channelId) {
      await (await dm(channelId)).sendTyping()
    },
    async messagesAfter(channelId, after) {
      const page = await (await dm(channelId)).messages.fetch({
        after,
        limit: MESSAGES_PAGE_LIMIT,
        cache: false,
      })
      return page.map(toDiscordMessage)
    },
    async registerCommands(commands) {
      if (applicationId === undefined) throw new Error("the bot has not connected to Discord yet")
      await client.rest.put(Routes.applicationCommands(applicationId), {
        body: toCommandsBody(commands),
      })
    },
    destroy: stop,
  }
}

/** Open each client with discord.js. */
export function discordJsClients(deps: Pick<DiscordJsDeps, "warn">): OpenDiscordClient {
  const create = (options: ClientOptions) => new Client(options)
  return (token, events) => openDiscordJsClient(token, events, { ...deps, create })
}
