import {
  type BotGroupsSnapshot,
  type BotGroupView,
  type BotPeerMessagePage,
  type BotPeerMessageView,
  PEER_MESSAGE_PAGE,
} from "../../shared/peers"
import type { PeerMessageRecord } from "./domain"
import { membersOf, requireGroup } from "./groups"
import type { PeerState } from "./store"

export function groupView(state: PeerState, groupId: string): BotGroupView {
  const group = requireGroup(state, groupId)
  return {
    id: groupId,
    name: group.name,
    purpose: group.purpose,
    members: membersOf(state, groupId).map(({ botId, member }) => ({
      botId,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
    ...(group.paused === undefined ? {} : { paused: group.paused }),
    createdAt: group.createdAt,
  }
}

export function groupsSnapshot(state: PeerState): BotGroupsSnapshot {
  return {
    groups: [...state.groups]
      .sort(
        ([leftId, left], [rightId, right]) =>
          left.createdAt - right.createdAt || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0),
      )
      .map(([groupId]) => groupView(state, groupId)),
  }
}

export function messageView(messageId: string, record: PeerMessageRecord): BotPeerMessageView {
  return {
    id: messageId,
    groupId: record.groupId,
    from: record.from,
    to: record.to,
    threadId: record.threadId,
    ...(record.replyTo === undefined ? {} : { replyTo: record.replyTo }),
    expectsReply: record.expectsReply,
    depth: record.depth,
    text: record.text,
    sentAt: record.sentAt,
    state: record.state,
    ...(record.refusal === undefined ? {} : { refusal: record.refusal }),
    ...(record.withdrawal === undefined ? {} : { withdrawal: record.withdrawal }),
  }
}

export function messagePage(
  state: PeerState,
  groupId: string,
  before: string | undefined,
): BotPeerMessagePage {
  const group = requireGroup(state, groupId)
  const ordered = [...state.messages]
    .filter(([, record]) => record.groupId === groupId)
    .sort(
      ([leftId, left], [rightId, right]) =>
        left.sentAt - right.sentAt || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0),
    )
  const end = before === undefined ? ordered.length : ordered.findIndex(([id]) => id === before)
  if (end === -1) throw new Error(`no message "${before}" in group "${group.name}"`)
  const start = Math.max(0, end - PEER_MESSAGE_PAGE)
  const page = ordered.slice(start, end)
  const first = page[0]
  return {
    messages: page.map(([messageId, record]) => messageView(messageId, record)),
    ...(start === 0 || first === undefined ? {} : { earlier: first[0] }),
  }
}
