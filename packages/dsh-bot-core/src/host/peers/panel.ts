import {
  type BotGroupsSnapshot,
  type BotGroupView,
  type BotPeerMessagePage,
  parseBotId,
  parseGroupChange,
  parseGroupId,
  parseGroupInput,
  parseGroupJoin,
  parseGroupPaused,
  parseMemberRole,
  parseMessageCursor,
} from "../../shared/peers"
import type { RemoteCaller } from "../connectors/approvals"
import type { PeerGroups } from "./groups"
import { groupsSnapshot, groupView, messagePage } from "./views"

export interface PeerPanelDeps {
  readonly groups: PeerGroups
}

export interface PeerPanel {
  snapshot(caller: RemoteCaller | undefined): BotGroupsSnapshot
  subscribe(listener: () => void): () => void
  messages(
    caller: RemoteCaller | undefined,
    groupId: unknown,
    before: unknown,
    signal: AbortSignal | undefined,
  ): BotPeerMessagePage
  create(caller: RemoteCaller | undefined, input: unknown): Promise<BotGroupView>
  update(caller: RemoteCaller | undefined, groupId: unknown, change: unknown): Promise<BotGroupView>
  deleteGroup(caller: RemoteCaller | undefined, groupId: unknown): Promise<BotGroupsSnapshot>
  join(
    caller: RemoteCaller | undefined,
    groupId: unknown,
    botId: unknown,
    join: unknown,
  ): Promise<BotGroupView>
  leave(caller: RemoteCaller | undefined, botId: unknown): Promise<BotGroupsSnapshot>
  setRole(caller: RemoteCaller | undefined, botId: unknown, role: unknown): Promise<BotGroupView>
  setPaused(
    caller: RemoteCaller | undefined,
    groupId: unknown,
    paused: unknown,
  ): Promise<BotGroupView>
}

export function requireOwner(caller: RemoteCaller | undefined): void {
  if (caller?.kind !== "owner") throw new Error("only the owner of this DSH manages bot groups")
}

export function createPeerPanel(deps: PeerPanelDeps): PeerPanel {
  const { groups } = deps
  const view = (groupId: string) => groupView(groups.state(), groupId)
  const snapshot = () => groupsSnapshot(groups.state())
  return {
    snapshot(caller) {
      requireOwner(caller)
      return snapshot()
    },
    subscribe: (listener) => groups.subscribe(listener),
    messages(caller, groupId, before, signal) {
      requireOwner(caller)
      signal?.throwIfAborted()
      return messagePage(groups.state(), parseGroupId(groupId), parseMessageCursor(before))
    },
    async create(caller, input) {
      requireOwner(caller)
      return view(await groups.create(parseGroupInput(input)))
    },
    async update(caller, groupId, change) {
      requireOwner(caller)
      return view(await groups.update(parseGroupId(groupId), parseGroupChange(change)))
    },
    async deleteGroup(caller, groupId) {
      requireOwner(caller)
      await groups.deleteGroup(parseGroupId(groupId))
      return snapshot()
    },
    async join(caller, groupId, botId, join) {
      requireOwner(caller)
      return view(await groups.join(parseGroupId(groupId), parseBotId(botId), parseGroupJoin(join)))
    },
    async leave(caller, botId) {
      requireOwner(caller)
      await groups.leave(parseBotId(botId))
      return snapshot()
    },
    async setRole(caller, botId, role) {
      requireOwner(caller)
      return view(await groups.setRole(parseBotId(botId), parseMemberRole(role)))
    },
    async setPaused(caller, groupId, paused) {
      requireOwner(caller)
      return view(await groups.setPaused(parseGroupId(groupId), parseGroupPaused(paused)))
    },
  }
}
