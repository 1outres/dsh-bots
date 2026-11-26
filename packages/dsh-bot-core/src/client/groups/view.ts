import type { BotsSnapshot, BotView } from "../../shared/bots"
import type {
  BotGroupMemberView,
  BotGroupPause,
  BotGroupsSnapshot,
  BotGroupView,
  BotPeerLimit,
  BotPeerMessageView,
  BotPeerRefusal,
  BotPeerWithdrawal,
} from "../../shared/peers"
import type { SettingsBadge } from "../settings-frame/sections"
import type { Translate } from "../types"
import type { Choice, PillTone } from "../ui"
import type { GroupsState } from "./model"

export interface GroupMembership {
  readonly group: BotGroupView
  readonly member: BotGroupMemberView
}

export interface GroupMemberEntry {
  readonly member: BotGroupMemberView
  readonly bot: BotView | undefined
}

export interface MessageThread {
  readonly id: string
  readonly messages: readonly BotPeerMessageView[]
  readonly lastSentAt: number
}

export interface PillView {
  readonly tone: PillTone
  readonly label: string
}

export function membershipOf(
  snapshot: BotGroupsSnapshot,
  botId: string,
): GroupMembership | undefined {
  for (const group of snapshot.groups) {
    const member = group.members.find((each) => each.botId === botId)
    if (member !== undefined) return { group, member }
  }
  return undefined
}

export function selectableBots(bots: BotsSnapshot): readonly BotView[] {
  const pending = new Set(bots.pending.map((each) => each.id))
  return bots.bots.filter((bot) => !pending.has(bot.id))
}

export function memberEntries(
  group: BotGroupView,
  bots: readonly BotView[],
): readonly GroupMemberEntry[] {
  return group.members.map((member) => ({
    member,
    bot: bots.find((bot) => bot.id === member.botId),
  }))
}

export function botName(bots: readonly BotView[], botId: string): string {
  return bots.find((bot) => bot.id === botId)?.name ?? botId
}

export function joinChoices(
  t: Translate,
  snapshot: BotGroupsSnapshot,
  bots: readonly BotView[],
  groupId: string,
): readonly Choice<string>[] {
  const free = bots
    .filter((bot) => membershipOf(snapshot, bot.id) === undefined)
    .map((bot) => ({ value: bot.id, label: bot.name }))
  const elsewhere = snapshot.groups
    .filter((group) => group.id !== groupId)
    .flatMap((group) => {
      const heading = t("groups.add.inGroup", { group: group.name })
      return group.members.flatMap((member) => {
        const bot = bots.find((each) => each.id === member.botId)
        return bot === undefined ? [] : [{ value: bot.id, label: bot.name, group: heading }]
      })
    })
  return [...free, ...elsewhere]
}

export function limitLabel(t: Translate, limit: BotPeerLimit): string {
  return t(`groups.limit.${limit}`)
}

export function pausePill(t: Translate, pause: BotGroupPause): PillView {
  return pause.reason === "owner"
    ? { tone: "idle", label: t("groups.paused.owner") }
    : { tone: "danger", label: t("groups.paused.limit") }
}

export function pauseDetail(
  t: Translate,
  pause: BotGroupPause,
  instant: (at: number) => string,
): string {
  const at = instant(pause.at)
  return pause.reason === "owner" ? at : `${at} · ${limitLabel(t, pause.detail)}`
}

export function groupsBadge(state: GroupsState): SettingsBadge | null {
  if (state.status !== "ready") return null
  const stopped = state.snapshot.groups.some((group) => group.paused?.reason === "limit")
  return stopped ? { tone: "danger", label: (t) => t("groups.badge.limit") } : null
}

export function threadsOf(messages: readonly BotPeerMessageView[]): readonly MessageThread[] {
  const threads = new Map<string, BotPeerMessageView[]>()
  for (const message of messages) {
    const thread = threads.get(message.threadId)
    if (thread === undefined) threads.set(message.threadId, [message])
    else thread.push(message)
  }
  return [...threads]
    .map(([id, items]) => {
      const ordered = [...items].sort(bySentAt)
      return { id, messages: ordered, lastSentAt: ordered.at(-1)?.sentAt ?? 0 }
    })
    .sort((a, b) => b.lastSentAt - a.lastSentAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

const bySentAt = (a: BotPeerMessageView, b: BotPeerMessageView) =>
  a.sentAt - b.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export function refusalLabel(t: Translate, refusal: BotPeerRefusal): string {
  return refusal === "paused" ? t("groups.refusal.paused") : limitLabel(t, refusal)
}

export function withdrawalLabel(t: Translate, withdrawal: BotPeerWithdrawal): string {
  return t(`groups.withdrawal.${withdrawal}`)
}

export function messagePill(t: Translate, message: BotPeerMessageView): PillView | null {
  switch (message.state) {
    case "delivered":
      return null
    case "queued":
      return { tone: "busy", label: t("groups.message.queued") }
    case "withdrawn":
      return { tone: "idle", label: t("groups.message.withdrawn") }
    case "expired":
      return { tone: "idle", label: t("groups.message.expired") }
    case "refused":
      return { tone: "danger", label: t("groups.message.refused") }
  }
}

export function messageReason(t: Translate, message: BotPeerMessageView): string | undefined {
  if (message.state === "refused" && message.refusal !== undefined) {
    return refusalLabel(t, message.refusal)
  }
  if (message.state === "withdrawn" && message.withdrawal !== undefined) {
    return withdrawalLabel(t, message.withdrawal)
  }
  return undefined
}

export const FOLDED_LINES = 6

const FOLDED_CHARACTERS = 480

export function isLongMessage(text: string): boolean {
  return text.split("\n").length > FOLDED_LINES || [...text].length > FOLDED_CHARACTERS
}

export const MESSAGES_DETAIL_PREFIX = "messages:"

export const messagesDetail = (groupId: string) => `${MESSAGES_DETAIL_PREFIX}${groupId}`

export function groupOfDetail(detail: string | null): string | undefined {
  if (detail === null || !detail.startsWith(MESSAGES_DETAIL_PREFIX)) return undefined
  return detail.slice(MESSAGES_DETAIL_PREFIX.length)
}

export function activityKey(group: BotGroupView): string {
  const { messages, queued, lastSentAt } = group.activity
  return `${messages}:${queued}:${lastSentAt ?? ""}`
}
