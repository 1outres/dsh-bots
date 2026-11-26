import type {
  BotActivity,
  BotAnswerResult,
  BotChannelConnectionState,
  BotChannelLink,
  BotCommandId,
  BotCommandOutcome,
  BotDeliveryFailure,
  BotInboundMessage,
  BotInteractionAnswer,
  ConnectorActionView,
  ConnectorDecision,
  ConnectorDecisionResult,
} from "@1outres/dsh-bot-core"
import type { ApprovalTables, RecordTable } from "../src/host/actions/records"
import type { DiscordActions, DiscordAuthor, DiscordMessage } from "../src/host/discord"
import type { DiscordSettings } from "../src/host/fields"
import type { Scheduler } from "../src/host/ports"

export function manualClock() {
  let now = 0
  const pending = new Set<{ at: number; work: () => void }>()
  const scheduler: Scheduler = {
    later(ms, work) {
      const entry = { at: now + ms, work }
      pending.add(entry)
      return () => {
        pending.delete(entry)
      }
    },
  }
  return {
    scheduler,
    now: () => now,
    pending: () => pending.size,
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const next = [...pending]
          .filter((entry) => entry.at <= until)
          .sort((a, b) => a.at - b.at)[0]
        if (next === undefined) break
        pending.delete(next)
        now = next.at
        next.work()
      }
      now = until
    },
  }
}

export function fakeActions(overrides: Partial<DiscordActions> = {}) {
  const calls: string[] = []
  const actions: DiscordActions = {
    async openDm(userId) {
      calls.push(`openDm ${userId}`)
      return `dm-${userId}`
    },
    async send(channelId, message) {
      const files = (message.files ?? [])
        .map((file) => ` [${file.name} ${file.data.byteLength}]`)
        .join("")
      const reply = message.replyTo === undefined ? "" : ` (reply to ${message.replyTo})`
      calls.push(`send ${channelId} ${message.content}${files}${reply}`)
      return `m${calls.length}`
    },
    async edit(channelId, messageId, message) {
      calls.push(`edit ${channelId} ${messageId} ${message.content}`)
      return "edited"
    },
    async remove(channelId, messageId) {
      calls.push(`remove ${channelId} ${messageId}`)
      return "removed"
    },
    async pin(channelId, messageId) {
      calls.push(`pin ${channelId} ${messageId}`)
      return "pinned"
    },
    async react(channelId, messageId, emoji) {
      calls.push(`react ${channelId} ${messageId} ${emoji}`)
    },
    async typing(channelId) {
      calls.push(`typing ${channelId}`)
    },
    async messagesAfter(channelId, after) {
      calls.push(`messagesAfter ${channelId} ${after}`)
      return []
    },
    async registerCommands(commands) {
      calls.push(`commands ${commands.map((command) => command.name).join(",")}`)
    },
    ...overrides,
  }
  return { actions, calls }
}

export const ALLOWED = "111111111111111111"
export const OTHER = "222222222222222222"
export const GUILD = "333333333333333333"
export const HOME_CHANNEL = "444444444444444444"

export const DM_SETTINGS: DiscordSettings = {
  token: "tok",
  home: "dm",
  approvers: [ALLOWED],
  language: "",
}

export const CHANNEL_SETTINGS: DiscordSettings = {
  token: "tok",
  home: `${GUILD}:${HOME_CHANNEL}`,
  approvers: [ALLOWED],
  language: "",
}

export function channelMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return directMessage({
    channelId: HOME_CHANNEL,
    guildId: GUILD,
    server: { name: "Team", channel: "general" },
    ...overrides,
  })
}

export function author(id: string, bot = false): DiscordAuthor {
  return { id, username: `user${id.slice(-2)}`, displayName: `User ${id.slice(-2)}`, bot }
}

export function directMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: "1001",
    channelId: "dm-in",
    guildId: null,
    server: null,
    kind: "default",
    author: author(ALLOWED),
    content: "hello",
    attachments: [],
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

export function fakeLink(settings: DiscordSettings) {
  const controller = new AbortController()
  const delivered: BotInboundMessage[] = []
  const reports: BotChannelConnectionState[] = []
  const commands: BotCommandId[] = []
  let activity: BotActivity = "idle"
  let refuse: BotDeliveryFailure | undefined
  let outcome: BotCommandOutcome = { ok: true, result: { command: "stop", outcome: "idle" } }
  const answers: { interactionId: string; answer: BotInteractionAnswer }[] = []
  const holds: string[] = []
  let answerResult: BotAnswerResult = { accepted: true }
  const decisions: { actionId: string; decision: ConnectorDecision; person: string }[] = []
  let decide: (actionId: string) => ConnectorDecisionResult = () => ({
    accepted: false,
    reason: "not-found",
  })
  const ledger = new Map<string, ConnectorActionView>()
  const link: BotChannelLink<DiscordSettings> = {
    bot: { id: "b1", name: "Bot" },
    settings,
    signal: controller.signal,
    commands: [
      { id: "stop", description: { en: "Stop", ja: "停止" }, access: "anyone" },
      { id: "status", description: { en: "Status" }, access: "anyone" },
    ],
    async deliver(message) {
      if (refuse !== undefined) return { delivered: false, failure: refuse }
      delivered.push(message)
      return {
        delivered: true,
        receipt: { sessionId: "main", mode: "queue", images: 0, saved: [] },
      }
    },
    async run(command) {
      commands.push(command)
      return outcome
    },
    async answer(interactionId, answer) {
      answers.push({ interactionId, answer })
      return answerResult
    },
    async hold(interactionId) {
      holds.push(interactionId)
      return { accepted: true }
    },
    async decide(actionId, decision, person) {
      decisions.push({ actionId, decision, person })
      return decide(actionId)
    },
    pendingActions(person) {
      if (controller.signal.aborted) return { ok: false, reason: "closed" }
      if (!settings.approvers.includes(person)) return { ok: false, reason: "not-approver" }
      const actions = [...ledger.values()]
        .filter((action) => action.status.state === "pending")
        .sort((a, b) => a.createdAt - b.createdAt)
      return { ok: true, actions }
    },
    openActions: () =>
      [...ledger.values()]
        .filter((action) => action.status.state === "pending")
        .sort((a, b) => a.createdAt - b.createdAt),
    connectorAction: (actionId) => ledger.get(actionId),
    activity: () => activity,
    report: (state) => reports.push(state),
  }
  return {
    link,
    controller,
    delivered,
    texts: () => delivered.map((message) => message.text),
    reports,
    commands,
    refuse(failure: BotDeliveryFailure | undefined) {
      refuse = failure
    },
    answerWith(next: BotCommandOutcome) {
      outcome = next
    },
    setActivity(next: BotActivity) {
      activity = next
    },
    answers,
    holds,
    answerWithResult(next: BotAnswerResult) {
      answerResult = next
    },
    decisions,
    decideWith(next: (actionId: string) => ConnectorDecisionResult) {
      decide = next
    },
    keep(...actions: ConnectorActionView[]) {
      for (const action of actions) ledger.set(action.id, action)
    },
    drop(actionId: string) {
      ledger.delete(actionId)
    },
  }
}

export async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}
export function memoryTable<V>(): RecordTable<V> & { readonly map: Map<string, V> } {
  const map = new Map<string, V>()
  return {
    map,
    get: (key) => map.get(key),
    entries: () => [...map.entries()],
    async put(key, value) {
      map.set(key, value)
    },
    async delete(key) {
      return map.delete(key)
    },
  }
}

export function memoryApprovalTables() {
  const cards = memoryTable<Parameters<ApprovalTables["cards"]["put"]>[1]>()
  const digests = memoryTable<Parameters<ApprovalTables["digests"]["put"]>[1]>()
  return { cards, digests } satisfies ApprovalTables
}
