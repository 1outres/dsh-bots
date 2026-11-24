import type {
  BotChannelCapabilities,
  BotChannelConnection,
  BotChannelOutput,
  BotOutboundFile,
} from "../../channel-contract"
import { carries } from "./capabilities"

/** One connection of a bot to a channel, as its outputs reach it. */
export interface ChannelOutlet {
  readonly channelId: string
  readonly capabilities: BotChannelCapabilities
  readonly connection: BotChannelConnection
}

/** How one channel took a file. */
export type FileDelivery =
  | { readonly channelId: string; readonly outcome: "sent" }
  | { readonly channelId: string; readonly outcome: "too-large"; readonly limit: number }
  | { readonly channelId: string; readonly outcome: "failed"; readonly message: string }

/**
 * Every bot's attached connections. Each connection gets its outputs one at a
 * time, in publication order, and only those its capabilities carry.
 */
export interface ChannelOutlets {
  /** Attach a connection until `signal` aborts. */
  attach(botId: string, outlet: ChannelOutlet, signal: AbortSignal): void
  publish(botId: string, output: BotChannelOutput): void
  /** Publish to one connection only (e.g. what was open before it attached). */
  publishTo(botId: string, channelId: string, output: BotChannelOutput): void
  /** The attached connections that take files at all, with their limits. */
  fileTargets(botId: string): readonly { readonly channelId: string; readonly maxBytes: number }[]
  /** Queue a file on every connection that takes files before returning; settles once each one settled. */
  sendFile(botId: string, file: BotOutboundFile): Promise<readonly FileDelivery[]>
}

interface Attached {
  readonly botId: string
  readonly outlet: ChannelOutlet
  tail: Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createChannelOutlets(deps: { warn(message: string): void }): ChannelOutlets {
  const attached = new Set<Attached>()
  const of = (botId: string) => [...attached].filter((entry) => entry.botId === botId)

  const enqueue = (entry: Attached, output: BotChannelOutput): Promise<void> => {
    const run = entry.tail.then(() => {
      if (!attached.has(entry)) throw new Error("the connection closed")
      return entry.outlet.connection.receive(output)
    })
    entry.tail = run.catch(() => {})
    return run
  }

  const deliver = (entry: Attached, output: BotChannelOutput) => {
    if (!carries(entry.outlet.capabilities, output)) return
    enqueue(entry, output).catch((error: unknown) => {
      if (!attached.has(entry)) return
      deps.warn(
        `bot-core: channel "${entry.outlet.channelId}" of bot "${entry.botId}" could not show a ${output.kind}: ${messageOf(error)}`,
      )
    })
  }

  return {
    attach(botId, outlet, signal) {
      if (signal.aborted) return
      const entry: Attached = { botId, outlet, tail: Promise.resolve() }
      attached.add(entry)
      signal.addEventListener("abort", () => attached.delete(entry), { once: true })
    },
    publish(botId, output) {
      for (const entry of of(botId)) deliver(entry, output)
    },
    publishTo(botId, channelId, output) {
      for (const entry of of(botId)) {
        if (entry.outlet.channelId === channelId) deliver(entry, output)
      }
    },
    fileTargets(botId) {
      return of(botId).flatMap((entry) => {
        const files = entry.outlet.capabilities.files
        return files === undefined
          ? []
          : [{ channelId: entry.outlet.channelId, maxBytes: files.maxBytes }]
      })
    },
    sendFile(botId, file) {
      const output: BotChannelOutput = { kind: "file", file }
      return Promise.all(
        of(botId).flatMap((entry): Promise<FileDelivery>[] => {
          const { channelId, capabilities } = entry.outlet
          if (capabilities.files === undefined) return []
          if (file.data.byteLength > capabilities.files.maxBytes) {
            return [
              Promise.resolve({
                channelId,
                outcome: "too-large",
                limit: capabilities.files.maxBytes,
              }),
            ]
          }
          return [
            enqueue(entry, output).then(
              (): FileDelivery => ({ channelId, outcome: "sent" }),
              (error: unknown): FileDelivery => ({
                channelId,
                outcome: "failed",
                message: messageOf(error),
              }),
            ),
          ]
        }),
      )
    },
  }
}
