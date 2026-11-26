import type {
  BotEnvironmentHostState,
  EnvironmentHostPairing,
  TrustTokenPreview,
} from "../../shared/environment-host"
import type { Observable } from "../observable"
import type { BotEnvironmentHostRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"
import type { RemoteResult } from "../types"

export interface VmHostClient extends Observable<FeedState<BotEnvironmentHostState>> {
  check(): Promise<BotEnvironmentHostState>
  previewToken(token: string): Promise<TrustTokenPreview>
  pair(pairing: EnvironmentHostPairing): Promise<BotEnvironmentHostState>
  useLocal(project: string): Promise<BotEnvironmentHostState>
  setProject(project: string): Promise<BotEnvironmentHostState>
  forget(): Promise<BotEnvironmentHostState>
  refreshImage(): Promise<BotEnvironmentHostState>
  startImage(): Promise<BotEnvironmentHostState>
  cancelImage(): Promise<BotEnvironmentHostState>
}

async function hostOf(mount: Promise<RemoteMount>): Promise<BotEnvironmentHostRemote> {
  return (await mountedRemote(mount)).botEnvironmentHost
}

export function createVmHostClient(mount: Promise<RemoteMount>): VmHostClient {
  const feed = followed(
    (remote: BotEnvironmentHostRemote) => remote.watch(),
    () => hostOf(mount),
  )
  const call = async <T>(run: (remote: BotEnvironmentHostRemote) => Promise<RemoteResult<T>>) =>
    unwrap(await run(await hostOf(mount)))
  return {
    getSnapshot: feed.getSnapshot,
    subscribe: feed.subscribe,
    check: () => call((remote) => remote.check()),
    previewToken: (token) => call((remote) => remote.previewToken(token)),
    pair: (pairing) => call((remote) => remote.pair(pairing)),
    useLocal: (project) => call((remote) => remote.useLocal(project)),
    setProject: (project) => call((remote) => remote.setProject(project)),
    forget: () => call((remote) => remote.forget()),
    refreshImage: () => call((remote) => remote.refreshImage()),
    startImage: () => call((remote) => remote.startImage()),
    cancelImage: () => call((remote) => remote.cancelImage()),
  }
}
