import type {
  BotChannel,
  BotChannelConnection,
  BotChannelLink,
  BotChannelValuesOf,
} from "../../contract"
import type { BotChannelConnectionState, BotChannelField } from "../../shared/channels"
import type { VaultIncidentView } from "../../shared/vaults"
import type { ConnectorApprovals } from "../connectors/approvals"
import type { InteractionBoard } from "../interactions/board"
import type { SenderAnswers } from "../senders/answers"
import { commandsOf } from "./capabilities"
import { type ConversationDeps, openMainConversation } from "./conversation"
import { channelRecordKey } from "./domain"
import type { ChannelOutlets } from "./outlets"
import { ownersOf } from "./owners"
import type { ProfileSync } from "./profile/sync"
import type { ChannelSettings } from "./settings"
import type { SharedSettings } from "./shared-settings"

export interface HubBot {
  readonly id: string
  readonly name: string
}

export interface ChannelHubDeps {
  channels(): readonly BotChannel[]
  bots(): readonly HubBot[]
  settings: Pick<ChannelSettings, "readiness" | "revision" | "resolve">
  shared: Pick<SharedSettings, "status" | "revision" | "resolve">
  conversation: ConversationDeps
  outlets: Pick<ChannelOutlets, "attach" | "publishTo">
  interactions: Pick<InteractionBoard, "mainOf">
  approvals: Pick<ConnectorApprovals, "open" | "pending" | "fromChannel" | "pendingFor" | "find">
  incidents: { open(botId: string): readonly VaultIncidentView[] }
  profiles: Pick<ProfileSync, "attached" | "reported">
  senders: Pick<SenderAnswers, "open" | "fromChannel" | "pendingFor" | "find">
  warn(message: string): void
}

export interface ChannelHub {
  sync(): void
  state(botId: string, channelId: string): BotChannelConnectionState | undefined
  subscribe(listener: () => void): () => void
  dispose(): Promise<void>
}

interface Slot {
  readonly channel: BotChannel
  readonly revision: string
  readonly controller: AbortController
  state: BotChannelConnectionState
  readonly connected: Promise<BotChannelConnection | undefined>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createChannelHub(deps: ChannelHubDeps): ChannelHub {
  const slots = new Map<string, Slot>()
  const closing = new Map<string, Promise<void>>()
  const listeners = new Set<() => void>()
  let disposed = false
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }

  const stop = (key: string, slot: Slot) => {
    slots.delete(key)
    slot.controller.abort()
    const previous = closing.get(key) ?? Promise.resolve()
    const done = slot.connected
      .then((connection) => connection?.close())
      .catch((error: unknown) => {
        deps.warn(`bot-core: closing channel "${slot.channel.id}" failed: ${messageOf(error)}`)
      })
      .then(() => previous)
    closing.set(key, done)
    void done.then(() => {
      if (closing.get(key) === done) closing.delete(key)
    })
  }

  const sharedOf = (channel: BotChannel) =>
    channel.shared === undefined
      ? Promise.resolve({})
      : deps.shared.resolve({ id: channel.id, shared: channel.shared })

  const sharedReady = (channel: BotChannel) =>
    channel.shared === undefined ||
    deps.shared.status({ id: channel.id, shared: channel.shared }).state === "ready"

  const revisionOf = (botId: string, channel: BotChannel) =>
    `${deps.settings.revision(botId, channel.id)}:${channel.shared === undefined ? 0 : deps.shared.revision(channel.id)}`

  const start = (key: string, bot: HubBot, channel: BotChannel, revision: string) => {
    const controller = new AbortController()
    const { signal } = controller
    const previous = closing.get(key) ?? Promise.resolve()
    const slot: Slot = {
      channel,
      revision,
      controller,
      state: { state: "connecting" },
      connected: (async () => {
        await previous
        if (signal.aborted) return undefined
        const settings = await deps.settings.resolve(bot.id, channel)
        const shared = await sharedOf(channel)
        if (signal.aborted) return undefined
        const { capabilities } = channel
        const owners = ownersOf(channel, settings)
        const deciding = {
          id: channel.id,
          name: channel.name,
          approvers: capabilities.connectorActions === true ? owners : new Set<string>(),
          signal,
        }
        const answering = {
          id: channel.id,
          name: channel.name,
          approvers: capabilities.senderInquiries === true ? owners : new Set<string>(),
          signal,
        }
        const conversation = openMainConversation(
          deps.conversation,
          { botId: bot.id, channel: { id: channel.id, name: channel.name }, capabilities, owners },
          signal,
        )
        const link: BotChannelLink<BotChannelValuesOf<readonly BotChannelField[]>> = {
          bot: { id: bot.id, name: bot.name },
          settings,
          shared,
          signal,
          commands: commandsOf(capabilities),
          deliver: (message) => conversation.deliver(message),
          run: (command, person) => conversation.run(command, person),
          answer: (interactionId, answer) => conversation.answer(interactionId, answer),
          hold: (interactionId) => conversation.hold(interactionId),
          decide: (actionId, decision, person) =>
            deps.approvals.fromChannel(bot.id, deciding, person, actionId, decision),
          pendingActions: (person) => deps.approvals.pendingFor(bot.id, deciding, person),
          openActions: () =>
            capabilities.connectorActions === true ? deps.approvals.pending(bot.id) : [],
          connectorAction: (actionId) =>
            capabilities.connectorActions !== true
              ? undefined
              : deps.approvals.find(bot.id, actionId),
          answerSender: (inquiryId, choice, person) =>
            deps.senders.fromChannel(bot.id, answering, person, inquiryId, choice),
          pendingSenderInquiries: (person) => deps.senders.pendingFor(bot.id, answering, person),
          openSenderInquiries: () =>
            capabilities.senderInquiries === true ? deps.senders.open(bot.id) : [],
          senderInquiry: (inquiryId) =>
            capabilities.senderInquiries !== true
              ? undefined
              : deps.senders.find(bot.id, inquiryId),
          activity: () => conversation.activity(),
          report(state) {
            if (signal.aborted) return
            slot.state = state
            publish()
          },
          reportProfile(report) {
            if (!signal.aborted) deps.profiles.reported(bot.id, channel.id, report)
          },
        }
        const connection = channel.connect(link)
        deps.outlets.attach(bot.id, { channelId: channel.id, capabilities, connection }, signal)
        for (const interaction of deps.interactions.mainOf(bot.id)) {
          deps.outlets.publishTo(bot.id, channel.id, { kind: "interaction-opened", interaction })
        }
        for (const action of deps.approvals.open(bot.id)) {
          deps.outlets.publishTo(bot.id, channel.id, { kind: "connector-action", action })
        }
        for (const inquiry of deps.senders.open(bot.id)) {
          deps.outlets.publishTo(bot.id, channel.id, { kind: "sender-inquiry", inquiry })
        }
        for (const incident of deps.incidents.open(bot.id)) {
          deps.outlets.publishTo(bot.id, channel.id, { kind: "credential-incident", incident })
        }
        if (capabilities.profile !== undefined) {
          deps.profiles.attached(bot.id, channel.id, capabilities.profile, signal)
        }
        return connection
      })().catch((error: unknown) => {
        if (!signal.aborted) {
          slot.state = { state: "failed", message: messageOf(error) }
          deps.warn(
            `bot-core: channel "${channel.id}" of bot "${bot.name}" (${bot.id}) could not connect: ${messageOf(error)}`,
          )
          publish()
        }
        return undefined
      }),
    }
    slots.set(key, slot)
  }

  return {
    sync() {
      if (disposed) return
      const desired = new Map<string, { bot: HubBot; channel: BotChannel; revision: string }>()
      const ready = deps.channels().filter(sharedReady)
      for (const bot of deps.bots()) {
        for (const channel of ready) {
          if (deps.settings.readiness(bot.id, channel).state !== "ready") continue
          desired.set(channelRecordKey(bot.id, channel.id), {
            bot,
            channel,
            revision: revisionOf(bot.id, channel),
          })
        }
      }
      let changed = false
      for (const [key, slot] of [...slots]) {
        const wanted = desired.get(key)
        if (wanted?.channel === slot.channel && wanted.revision === slot.revision) continue
        stop(key, slot)
        changed = true
      }
      for (const [key, wanted] of desired) {
        if (slots.has(key)) continue
        start(key, wanted.bot, wanted.channel, wanted.revision)
        changed = true
      }
      if (changed) publish()
    },
    state: (botId, channelId) => slots.get(channelRecordKey(botId, channelId))?.state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async dispose() {
      disposed = true
      for (const [key, slot] of [...slots]) stop(key, slot)
      listeners.clear()
      await Promise.all([...closing.values()])
    },
  }
}
