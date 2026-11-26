import type { BotChannelConnectionState } from "@1outres/dsh-bot-core"
import type {
  DiscordAccount,
  DiscordActions,
  DiscordClient,
  DiscordCommandInvocation,
  DiscordComponentPress,
  DiscordGatewayMode,
  DiscordMessage,
  DiscordModalSubmit,
  OpenDiscordClient,
} from "./discord"
import type { Scheduler } from "./ports"

export const BASE_RETRY_MS = 1_000
export const MAX_RETRY_MS = 60_000

export interface DiscordSessionEvents {
  ready(account: DiscordAccount): void
  message(message: DiscordMessage): void
  command(invocation: DiscordCommandInvocation): void
  component(press: DiscordComponentPress): void
  modal(submit: DiscordModalSubmit): void
}

export interface DiscordConnectionDeps {
  token: string
  mode: DiscordGatewayMode
  open: OpenDiscordClient
  scheduler: Scheduler
  events: DiscordSessionEvents
  report(state: BotChannelConnectionState): void
}

export interface DiscordConnection extends DiscordActions {
  close(): Promise<void>
}

export function createDiscordConnection(deps: DiscordConnectionDeps): DiscordConnection {
  let closed = false
  let delay = BASE_RETRY_MS
  let account: DiscordAccount | undefined
  let cancelRetry: () => void = () => {}
  const live = (current: DiscordClient) => !closed && current === client

  const open = (): DiscordClient => {
    deps.report({ state: "connecting" })
    const current = deps.open(deps.token, deps.mode, {
      ready(next) {
        if (!live(current)) return
        delay = BASE_RETRY_MS
        account = next
        deps.report({ state: "connected", account: next.tag })
        deps.events.ready(next)
      },
      resumed() {
        if (!live(current)) return
        deps.report({ state: "connected", account: account?.tag })
      },
      reconnecting() {
        if (live(current)) deps.report({ state: "connecting" })
      },
      message(message) {
        if (live(current)) deps.events.message(message)
      },
      command(invocation) {
        if (live(current)) deps.events.command(invocation)
      },
      component(press) {
        if (live(current)) deps.events.component(press)
      },
      modal(submit) {
        if (live(current)) deps.events.modal(submit)
      },
      failed(failure) {
        if (!live(current)) return
        deps.report({ state: "failed", message: failure.reason })
        if (!failure.retryable) return
        const wait = delay
        delay = Math.min(delay * 2, MAX_RETRY_MS)
        cancelRetry = deps.scheduler.later(wait, () => {
          if (!closed) client = open()
        })
      },
    })
    return current
  }
  let client = open()

  return {
    openDm: (userId) => client.openDm(userId),
    send: (channelId, message) => client.send(channelId, message),
    edit: (channelId, messageId, message) => client.edit(channelId, messageId, message),
    remove: (channelId, messageId) => client.remove(channelId, messageId),
    pin: (channelId, messageId) => client.pin(channelId, messageId),
    react: (channelId, messageId, emoji) => client.react(channelId, messageId, emoji),
    typing: (channelId) => client.typing(channelId),
    messagesAfter: (channelId, after) => client.messagesAfter(channelId, after),
    registerCommands: (commands) => client.registerCommands(commands),
    setUsername: (username) => client.setUsername(username),
    setAvatar: (image) => client.setAvatar(image),
    async close() {
      if (closed) return
      closed = true
      cancelRetry()
      await client.destroy()
    },
  }
}
