import type {
  BotWorkspaceOptions,
  BotWorkspaceSettings,
  BotWorkspaceSettingsChange,
  BotWorkspacesSnapshot,
} from "../shared/workspaces"
import { followStream } from "./approvals/follow"
import { createStore, type Observable } from "./observable"
import type { BotWorkspacesRemote, RemoteMount } from "./remote"
import type { RemoteResult } from "./types"

/** The Workspaces owners grant bots (docs/specs/bot-managed-sessions.md §10), and changing them. */
export interface WorkspacesClient extends Observable<BotWorkspacesSnapshot | undefined> {
  /** What a grant can choose from now; rejects with the refusal. */
  options(): Promise<BotWorkspaceOptions>
  /** Each rejects with the Host's refusal. */
  grant(botId: string, workspaceId: string, settings: BotWorkspaceSettings): Promise<void>
  configure(botId: string, workspaceId: string, change: BotWorkspaceSettingsChange): Promise<void>
  revoke(botId: string, workspaceId: string): Promise<void>
  dispose(): void
}

/** Follow `botWorkspaces.watch`; undefined until the first snapshot, the last one stays while it reconnects. */
export function watchWorkspaces(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
): WorkspacesClient {
  const state = createStore<BotWorkspacesSnapshot | undefined>(undefined)
  let disposed = false
  let stop: (() => void) | undefined
  const face = mount.then((mounted) => {
    if (mounted.status === "failed") throw new Error("bots are unavailable")
    return mounted.remote.botWorkspaces
  })
  void face.then(
    (remote) => {
      if (disposed) return
      stop = followStream({
        generation,
        open: () => remote.watch(),
        item: (snapshot: BotWorkspacesSnapshot) => state.set(snapshot),
        lost: () => {},
      })
    },
    () => {},
  )
  const call = async <T>(request: (remote: BotWorkspacesRemote) => Promise<RemoteResult<T>>) => {
    const result = await request(await face)
    if (!result.ok) throw new Error(result.error.message ?? "request refused")
    return result.value
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    options: () => call((remote) => remote.options()),
    grant: async (botId, workspaceId, settings) => {
      await call((remote) => remote.grant(botId, workspaceId, settings))
    },
    configure: async (botId, workspaceId, change) => {
      await call((remote) => remote.configure(botId, workspaceId, change))
    },
    revoke: async (botId, workspaceId) => {
      await call((remote) => remote.revoke(botId, workspaceId))
    },
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
