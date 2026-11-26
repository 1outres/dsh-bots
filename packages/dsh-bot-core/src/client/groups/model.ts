import type {
  BotGroupChange,
  BotGroupInput,
  BotGroupJoin,
  BotGroupsSnapshot,
  BotGroupView,
  BotPeerMessagePage,
} from "../../shared/peers"
import { followStream } from "../approvals/follow"
import { createFeedHub } from "../feed-hub"
import { createStore, type Observable } from "../observable"
import type { BotGroupsRemote, RemoteMount } from "../remote"
import type { RemoteResult } from "../types"

export type GroupsFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }

export class GroupsError extends Error {
  override readonly name = "GroupsError"
  constructor(readonly failure: GroupsFailure) {
    super(failure.message)
  }
}

export type GroupsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotGroupsSnapshot }
  | { readonly status: "failed"; readonly failure: GroupsFailure }

export interface GroupsOperations {
  create(input: BotGroupInput): Promise<BotGroupView>
  update(groupId: string, change: BotGroupChange): Promise<BotGroupView>
  deleteGroup(groupId: string): Promise<BotGroupsSnapshot>
  join(groupId: string, botId: string, join: BotGroupJoin): Promise<BotGroupView>
  leave(botId: string): Promise<BotGroupsSnapshot>
  setRole(botId: string, role: string): Promise<BotGroupView>
  setPaused(groupId: string, paused: boolean): Promise<BotGroupView>
  messages(groupId: string, before: string | undefined): Promise<BotPeerMessagePage>
}

export type GroupsFeed = Observable<GroupsState> & GroupsOperations

export interface GroupsDeps {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
}

interface Followed extends Observable<GroupsState> {
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function groupsOf(mount: Promise<RemoteMount>): Promise<BotGroupsRemote> {
  const mounted = await mount
  if (mounted.status === "failed") throw new GroupsError({ kind: "mount", message: mounted.error })
  return mounted.remote.botGroups
}

async function call<T>(
  mount: Promise<RemoteMount>,
  run: (groups: BotGroupsRemote) => Promise<RemoteResult<T>>,
): Promise<T> {
  const groups = await groupsOf(mount)
  let result: RemoteResult<T>
  try {
    result = await run(groups)
  } catch (error) {
    throw new GroupsError({ kind: "connection", message: messageOf(error) })
  }
  if (result.ok) return result.value
  const { message } = result.error
  throw new GroupsError(
    message === undefined
      ? { kind: "protocol", message: "a refusal without a message" }
      : { kind: "refused", message },
  )
}

function follow(deps: GroupsDeps): Followed {
  const state = createStore<GroupsState>({ status: "loading" })
  let disposed = false
  let stop: (() => void) | undefined
  void groupsOf(deps.mount).then(
    (groups) => {
      if (disposed) return
      stop = followStream<BotGroupsSnapshot>({
        generation: deps.generation,
        open: () => groups.watch(),
        item: (snapshot) => state.set({ status: "ready", snapshot }),
        lost(message) {
          if (state.getSnapshot().status === "ready" || message === undefined) return
          state.set({ status: "failed", failure: { kind: "connection", message } })
        },
      })
    },
    (error: unknown) => {
      if (disposed) return
      state.set({
        status: "failed",
        failure:
          error instanceof GroupsError
            ? error.failure
            : { kind: "connection", message: messageOf(error) },
      })
    },
  )
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    dispose() {
      disposed = true
      stop?.()
    },
  }
}

export function createGroupsFeed(deps: GroupsDeps): GroupsFeed {
  const hub = createFeedHub<GroupsState, Followed, GroupsOperations>({
    name: "bot groups",
    idle: { status: "loading" },
    open: () => follow(deps),
    extend: () => ({
      create: (input) => call(deps.mount, (groups) => groups.create(input)),
      update: (groupId, change) => call(deps.mount, (groups) => groups.update(groupId, change)),
      deleteGroup: (groupId) => call(deps.mount, (groups) => groups.deleteGroup(groupId)),
      join: (groupId, botId, join) =>
        call(deps.mount, (groups) => groups.join(groupId, botId, join)),
      leave: (botId) => call(deps.mount, (groups) => groups.leave(botId)),
      setRole: (botId, role) => call(deps.mount, (groups) => groups.setRole(botId, role)),
      setPaused: (groupId, paused) =>
        call(deps.mount, (groups) => groups.setPaused(groupId, paused)),
      messages: (groupId, before) => call(deps.mount, (groups) => groups.messages(groupId, before)),
    }),
  })
  return hub.feed("all")
}
