import type { BotChannel } from "../../channel-contract"
import type { BotChannelPublicValues } from "../../shared/channels"

export interface AccountReconcilerDeps {
  channels(): readonly BotChannel[]
  ready(channel: BotChannel): boolean
  shared(channel: BotChannel): Promise<BotChannelPublicValues>
  listed(botId: string): boolean
  signal(): AbortSignal
  warn(message: string): void
}

export interface AccountReconciler {
  request(channelId?: string): void
  idle(): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createAccountReconciler(deps: AccountReconcilerDeps): AccountReconciler {
  const running = new Map<string, Promise<void>>()
  const again = new Set<string>()

  const run = (channel: BotChannel): Promise<void> => {
    const accounts = channel.accounts
    if (accounts === undefined || !deps.ready(channel)) return Promise.resolve()
    const work = (async () => {
      try {
        await accounts.reconcile({
          listed: deps.listed,
          shared: (await deps.shared(channel)) as never,
          signal: deps.signal(),
        })
      } catch (error) {
        deps.warn(
          `bot-core: channel "${channel.id}" could not clean up the accounts of deleted bots: ${messageOf(error)}`,
        )
      }
    })()
    running.set(channel.id, work)
    return work.then(() => {
      running.delete(channel.id)
      if (!again.delete(channel.id)) return
      const current = deps.channels().find((listed) => listed.id === channel.id)
      if (current !== undefined) return run(current)
    })
  }

  const request = (channel: BotChannel) => {
    if (running.has(channel.id)) {
      again.add(channel.id)
      return
    }
    void run(channel)
  }

  return {
    request(channelId) {
      for (const channel of deps.channels()) {
        if (channelId === undefined || channel.id === channelId) request(channel)
      }
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running.values()])
    },
  }
}
