import type {
  BotChannelConnection,
  BotChannelLink,
  BotChannelOutput,
  BotOutboundFile,
  BotReply,
  BotTurnState,
} from "@1outres/dsh-bot-core"
import { PENDING_COMMAND } from "./actions/command"
import { isActionCustomId } from "./actions/custom-id"
import { createActionPresenter } from "./actions/presenter"
import type { ApprovalRecords } from "./actions/records"
import type { DiscordConnection, DiscordSessionEvents } from "./connection"
import { createDmCursor } from "./cursor"
import {
  type DiscordAccount,
  type DiscordCommandInvocation,
  type DiscordCommandSpec,
  type DiscordMessage,
  MESSAGES_PAGE_LIMIT,
} from "./discord"
import type { FetchUrl } from "./download"
import type { DiscordSettings } from "./fields"
import { formatForDiscord } from "./format"
import { atHome, type DiscordHome, type DiscordPlace } from "./home"
import { createHomeTarget } from "./home-target"
import { hasContent, inboundMessageOf, isHomeMessage } from "./inbound"
import { createIncidentPresenter } from "./incidents/presenter"
import type { IncidentNotices } from "./incidents/records"
import { createInteractionPresenter } from "./interactions/presenter"
import type { Scheduler } from "./ports"
import { createSerialQueue } from "./queue"
import { compareSnowflakes } from "./snowflake"
import { splitMessage } from "./split"
import {
  commandText,
  deliveryFailureText,
  localeOf,
  notHomeText,
  settingsLocale,
  turnNotice,
  unknownCommandText,
} from "./texts"
import { createTypingKeeper } from "./typing"

/** The reaction a message gets once the bot's Main session accepted it. */
export const ACCEPTED_REACTION = "👀"
/** The reaction a message gets when it could not be delivered (a reply says why). */
export const FAILED_REACTION = "⚠️"

export interface DiscordBridgeDeps {
  link: BotChannelLink<DiscordSettings>
  /** Where the bot lives, from its settings. */
  home: DiscordHome
  /** Called once the home's Discord channel is known, before anything is posted there. */
  adopt(homeChannelId: string): Promise<void>
  /** The channel's id, as bot-core names the channel that answered an interaction. */
  channelId: string
  /** Connect the bot to Discord, passing its sessions, messages and commands to the bridge. */
  connect(events: DiscordSessionEvents): DiscordConnection
  scheduler: Scheduler
  /** Reads attachments from Discord's CDN. */
  fetch: FetchUrl
  /** Where this bot's connector action cards and pending lists sit, across connections. */
  records: ApprovalRecords
  /** Which of this bot's credential incidents each owner was shown, across connections. */
  incidents: IncidentNotices
  warn(message: string): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const CLOSING = "the Discord connection is closing"

/**
 * One bot's Discord home: the DMs with its owner, or one server text channel.
 * Messages written there, with their attachments, go to the bot's Main
 * session (in arrival order, each once) and get {@link ACCEPTED_REACTION}, or
 * {@link FAILED_REACTION} and a reply saying why. Everything bot-core sends
 * comes back to the home: replies (formatted for Discord, split to its
 * limit), files, notices of failed or stopped turns, "typing" while a turn
 * runs, interaction and connector action cards, the pending list and
 * credential incidents. The bot's commands are offered as slash commands
 * there. After a new Gateway session starts (the previous one could not be
 * resumed) the home is read for messages missed meanwhile.
 */
export function createDiscordBridge(deps: DiscordBridgeDeps): BotChannelConnection {
  const { link, home } = deps
  const owners: ReadonlySet<string> = new Set(link.settings.approvers)
  const here = (place: DiscordPlace) => atHome(home, place)
  const notices = settingsLocale(link.settings.language)
  const commands: readonly DiscordCommandSpec[] = [
    ...link.commands.map((command) => ({
      name: command.id,
      description: command.description.en,
      ...(command.description.ja === undefined ? {} : { descriptionJa: command.description.ja }),
    })),
    PENDING_COMMAND,
  ]
  const cursor = createDmCursor()
  let self: string | undefined
  let sessions = 0
  let closing: Promise<void> | undefined
  const closed = () => closing !== undefined || link.signal.aborted
  const warnUnlessClosed = (what: string) => (error: unknown) => {
    if (!closed()) deps.warn(`bot-discord: ${what}: ${messageOf(error)}`)
  }
  const inbound = createSerialQueue()
  const outbound = createSerialQueue()

  const connection = deps.connect({
    ready: (account) => started(account),
    message: (message) => receiveMessage(message),
    command: (invocation) => receiveCommand(invocation),
    component: (press) =>
      void (isActionCustomId(press.customId) ? actions.press(press) : interactions.press(press)),
    modal: (submit) => void interactions.submit(submit),
  })
  const target = createHomeTarget(home, connection.openDm)
  const interactions = createInteractionPresenter({
    link,
    actions: connection,
    home: target,
    atHome: here,
    owners,
    locale: notices,
    self: deps.channelId,
    outbound,
    closed,
    warn: deps.warn,
  })

  const actions = createActionPresenter({
    link,
    actions: connection,
    records: deps.records,
    home: target,
    atHome: here,
    locale: notices,
    self: deps.channelId,
    outbound,
    closed,
    warn: deps.warn,
  })

  const incidents = createIncidentPresenter({
    bot: link.bot,
    actions: connection,
    notices: deps.incidents,
    home: target,
    locale: notices,
    outbound,
    closed,
  })

  const typing = createTypingKeeper({
    show: (current) =>
      outbound.push(async () => {
        if (!current() || closed()) return
        const { channelId } = await target.channel()
        await connection.typing(channelId).catch(warnUnlessClosed("could not show typing"))
      }),
    scheduler: deps.scheduler,
    warn: deps.warn,
  })

  /** Post text at the home, in Discord-sized messages. */
  const post = (text: string) =>
    outbound.push(async () => {
      const { channelId } = await target.channel()
      for (const content of splitMessage(formatForDiscord(text))) {
        if (closed()) return
        await connection.send(channelId, { content })
      }
    })

  const reply = async (message: BotReply) => {
    await post(message.text)
    typing.pulse()
  }

  const sendFile = (file: BotOutboundFile) =>
    outbound.push(async () => {
      const { channelId } = await target.channel()
      const caption = file.caption === undefined ? [] : splitMessage(formatForDiscord(file.caption))
      const attached = caption.at(-1) ?? ""
      if (closed()) throw new Error(CLOSING)
      try {
        for (const content of caption.slice(0, -1)) await connection.send(channelId, { content })
        await connection.send(channelId, {
          content: attached,
          files: [{ name: file.name, data: file.data }],
        })
      } catch (error) {
        throw new Error(`Discord refused the file: ${messageOf(error)}`)
      }
      typing.pulse()
    })

  const turn = async (state: BotTurnState) => {
    if (closed()) return
    if (state.phase === "started") {
      typing.start()
      return
    }
    typing.stop()
    const notice = turnNotice(state, notices)
    if (notice !== undefined) await post(notice)
  }

  const receive = async (output: BotChannelOutput): Promise<void> => {
    if (closed()) throw new Error(CLOSING)
    switch (output.kind) {
      case "reply":
        return reply(output.reply)
      case "file":
        return sendFile(output.file)
      case "turn":
        return turn(output.turn)
      case "interaction-opened":
        return interactions.opened(output.interaction)
      case "interaction-updated":
        return interactions.updated(output.interaction)
      case "interaction-closed":
        return interactions.closed(output.closure)
      case "connector-action":
        return actions.received(output.action)
      case "credential-incident":
        return incidents.received(output.incident)
    }
  }

  const accept = async (message: DiscordMessage) => {
    if (!cursor.advance(message.channelId, message.id)) return
    if (home.kind === "dm") target.learn(message.channelId)
    if (!hasContent(message)) return
    const result = await link.deliver(inboundMessageOf(message, deps.fetch))
    if (closed()) return
    if (!result.delivered) {
      deps.warn(
        `bot-discord: a message of bot "${link.bot.name}" was not delivered: ${result.failure.message}`,
      )
    }
    await connection
      .react(message.channelId, message.id, result.delivered ? ACCEPTED_REACTION : FAILED_REACTION)
      .catch(warnUnlessClosed("could not react to a message"))
    if (!result.delivered) {
      await outbound.push(async () => {
        if (closed()) return
        await connection
          .send(message.channelId, {
            content: deliveryFailureText(result.failure, notices),
            replyTo: message.id,
          })
          .catch(warnUnlessClosed("could not say why a message was not delivered"))
      })
    }
  }

  function receiveMessage(message: DiscordMessage) {
    if (closed() || !isHomeMessage(message, home, self)) return
    inbound
      .push(async () => {
        if (!closed()) await accept(message)
      })
      .catch(warnUnlessClosed("could not take a direct message"))
  }

  async function answerCommand(invocation: DiscordCommandInvocation) {
    const locale = localeOf(invocation.locale)
    if (!here(invocation)) {
      return invocation.respond({ content: notHomeText(locale), ephemeral: true })
    }
    if (invocation.name === PENDING_COMMAND.name) {
      return invocation.respond(await actions.pending(invocation.userId, invocation.locale))
    }
    const command = link.commands.find((spec) => spec.id === invocation.name)
    if (command === undefined) {
      return invocation.respond({ content: unknownCommandText(locale), ephemeral: true })
    }
    const outcome = await link.run(command.id, invocation.userId)
    if (closed()) return
    await invocation.respond({ content: commandText(outcome, locale), ephemeral: false })
  }

  function receiveCommand(invocation: DiscordCommandInvocation) {
    if (closed()) return
    answerCommand(invocation).catch(warnUnlessClosed(`could not answer /${invocation.name}`))
  }

  const catchUp = (channelId: string, from: string) => async () => {
    let after = from
    for (;;) {
      if (closed()) return
      let page: readonly DiscordMessage[]
      try {
        page = await connection.messagesAfter(channelId, after)
      } catch (error) {
        warnUnlessClosed("could not read the messages missed in a DM")(error)
        return
      }
      const ordered = [...page].sort((a, b) => compareSnowflakes(a.id, b.id))
      for (const message of ordered) {
        if (closed()) return
        if (isHomeMessage(message, home, self)) await accept(message)
        after = message.id
      }
      if (page.length < MESSAGES_PAGE_LIMIT) return
    }
  }

  function started(account: DiscordAccount) {
    self = account.id
    sessions += 1
    connection
      .registerCommands(commands)
      .catch(warnUnlessClosed("could not register the slash commands"))
    if (sessions === 1) return
    for (const [channelId, last] of cursor.positions()) {
      inbound
        .push(catchUp(channelId, last))
        .catch(warnUnlessClosed("could not take the messages missed in a DM"))
    }
  }

  const onAbort = () => {
    close().catch((error: unknown) =>
      deps.warn(`bot-discord: could not disconnect: ${messageOf(error)}`),
    )
  }
  const shutdown = async () => {
    link.signal.removeEventListener("abort", onAbort)
    typing.stop()
    await connection.close()
    await Promise.all([inbound.idle(), outbound.idle()])
  }
  function close(): Promise<void> {
    closing ??= shutdown()
    return closing
  }
  link.signal.addEventListener("abort", onAbort, { once: true })
  if (link.activity() === "running") typing.start()
  outbound
    .push(async () => deps.adopt((await target.channel()).channelId))
    .catch(warnUnlessClosed("could not take over the records of the messages at the home"))
  actions
    .start()
    .catch(warnUnlessClosed("could not bring the connector action messages up to date"))

  return { receive, close }
}
