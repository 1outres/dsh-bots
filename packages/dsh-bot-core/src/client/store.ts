import { createStore, type Observable } from "./observable"
import {
  BOT_CORE_REMOTE,
  type BotCoreRemote,
  type BotsRemote,
  type RemoteMount,
  type RemoteNamespace,
} from "./remote"
import { type BotsState, snapshotOf } from "./session-classification"
import type { ClientContext } from "./types"

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function faceOf<Namespace extends RemoteNamespace>(
  ctx: ClientContext,
  namespace: Namespace,
): BotCoreRemote[Namespace] {
  const face = ctx.get(`remote.${namespace}`)
  if (face === undefined) throw new Error(`remote.${namespace} is not mounted`)
  return face as BotCoreRemote[Namespace]
}

export async function mountBotCoreRemote(ctx: ClientContext): Promise<RemoteMount> {
  try {
    await ctx.remote.$mount(BOT_CORE_REMOTE)
    const remote: BotCoreRemote = {
      bots: faceOf(ctx, "bots"),
      botFiles: faceOf(ctx, "botFiles"),
      botChannels: faceOf(ctx, "botChannels"),
      botInteractions: faceOf(ctx, "botInteractions"),
      botConnectors: faceOf(ctx, "botConnectors"),
      botConnectorActions: faceOf(ctx, "botConnectorActions"),
      botConnections: faceOf(ctx, "botConnections"),
      botConnectorStreams: faceOf(ctx, "botConnectorStreams"),
      botWeb: faceOf(ctx, "botWeb"),
      botManagedSessions: faceOf(ctx, "botManagedSessions"),
      botWorkspaces: faceOf(ctx, "botWorkspaces"),
      botMains: faceOf(ctx, "botMains"),
      botMainView: faceOf(ctx, "botMainView"),
      botSkills: faceOf(ctx, "botSkills"),
      botSettings: faceOf(ctx, "botSettings"),
      botNotes: faceOf(ctx, "botNotes"),
      botEnvironment: faceOf(ctx, "botEnvironment"),
      botEnvironmentHost: faceOf(ctx, "botEnvironmentHost"),
      botOnboarding: faceOf(ctx, "botOnboarding"),
      botVaults: faceOf(ctx, "botVaults"),
      botSenders: faceOf(ctx, "botSenders"),
    }
    return { status: "mounted", remote }
  } catch (error) {
    console.error("bot-core: mounting the Remote failed", error)
    return { status: "failed", error: messageOf(error) }
  }
}

export interface BotsStore extends Observable<BotsState> {
  remote(): BotsRemote | undefined
  dispose(): void
}

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000

function pause(ms: number, generation: Observable<object | undefined>, since: object | undefined) {
  return new Promise<void>((resolve) => {
    const reconnected = () => {
      const current = generation.getSnapshot()
      return current !== undefined && current !== since
    }
    const done = () => {
      clearTimeout(timer)
      off()
      resolve()
    }
    const timer = setTimeout(done, ms)
    const off = generation.subscribe(() => {
      if (reconnected()) done()
    })
    if (reconnected()) done()
  })
}

function disconnected(state: BotsState, error: string | undefined): BotsState {
  const snapshot = snapshotOf(state)
  if (snapshot !== undefined) return { status: "reconnecting", snapshot }
  return error === undefined ? { status: "unavailable" } : { status: "unavailable", error }
}

export function watchBots(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
): BotsStore {
  const state = createStore<BotsState>({ status: "loading" })
  let disposed = false
  let dispose: (() => void) | undefined
  let remote: BotsRemote | undefined

  const watch = async (face: BotsRemote) => {
    let backoff = BASE_DELAY_MS
    while (!disposed) {
      let error: string | undefined
      let delivered = false
      const attempt = generation.getSnapshot()
      try {
        const handle = face.watch()
        dispose = () => handle.dispose()
        for await (const snapshot of handle) {
          if (disposed) break
          delivered = true
          backoff = BASE_DELAY_MS
          state.set({ status: "ready", snapshot })
        }
      } catch (cause) {
        error = `watch: ${messageOf(cause)}`
        console.warn(`bot-core: ${error}`)
      } finally {
        dispose = undefined
      }
      if (disposed) return
      state.set(disconnected(state.getSnapshot(), error))
      await pause(backoff, generation, attempt)
      backoff = delivered ? BASE_DELAY_MS : Math.min(backoff * 2, MAX_DELAY_MS)
    }
  }

  void mount.then((mounted) => {
    if (disposed) return
    if (mounted.status === "failed") {
      state.set({ status: "failed", error: mounted.error })
      return
    }
    remote = mounted.remote.bots
    return watch(remote)
  })

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    remote: () => remote,
    dispose() {
      disposed = true
      dispose?.()
    },
  }
}
