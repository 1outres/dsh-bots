import type { BotManagedAnswerer, BotManagedSessionsSnapshot } from "../shared/managed-sessions"
import { followStream } from "./approvals/follow"
import { createStore, type Observable } from "./observable"
import type { BotManagedSessionsRemote, RemoteMount } from "./remote"
import type { StatusStore } from "./status"
import type { RemoteResult } from "./types"

/** The sessions bots' Main sessions manage, and the owner's changes to them (a refusal shows on the bot's row). */
export interface ManagedSessionsStore extends Observable<BotManagedSessionsSnapshot> {
  entrust(botId: string, sessionId: string): void
  release(botId: string, sessionId: string): void
  setAnswerer(botId: string, sessionId: string, answerer: BotManagedAnswerer): void
  dispose(): void
}

const NONE: BotManagedSessionsSnapshot = { sessions: [] }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Follow `botManagedSessions.watch`; the last snapshot stays while it reconnects. */
export function watchManagedSessions(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
  status: Pick<StatusStore, "set">,
): ManagedSessionsStore {
  const state = createStore<BotManagedSessionsSnapshot>(NONE)
  let disposed = false
  let stop: (() => void) | undefined
  let remote: BotManagedSessionsRemote | undefined
  void mount.then((mounted) => {
    if (disposed || mounted.status === "failed") return
    const face = mounted.remote.botManagedSessions
    remote = face
    stop = followStream({
      generation,
      open: () => face.watch(),
      item: (snapshot: BotManagedSessionsSnapshot) => state.set(snapshot),
      lost: () => {},
    })
  })
  const request = (
    botId: string,
    call: (face: BotManagedSessionsRemote) => Promise<RemoteResult<unknown>>,
  ) => {
    void (async () => {
      try {
        if (remote === undefined) throw new Error("bots are unavailable")
        const result = await call(remote)
        if (!result.ok) throw new Error(result.error.message ?? "request refused")
        status.set(botId, undefined)
      } catch (error) {
        status.set(botId, { error: messageOf(error) })
      }
    })()
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    entrust: (botId, sessionId) => request(botId, (face) => face.entrust(botId, sessionId)),
    release: (botId, sessionId) => request(botId, (face) => face.release(botId, sessionId)),
    setAnswerer: (botId, sessionId, answerer) =>
      request(botId, (face) => face.setAnswerer(botId, sessionId, answerer)),
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
