import type {
  BotEnvironmentHostState,
  CustomConnectRequest,
  CustomCredential,
  CustomPreview,
} from "../../shared/environment-host"
import type { Observable } from "../observable"
import type { BotEnvironmentHostRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"
import type { RemoteResult } from "../types"

export interface VmHostClient extends Observable<FeedState<BotEnvironmentHostState>> {
  check(): Promise<BotEnvironmentHostState>
  previewCustom(credential: CustomCredential): Promise<CustomPreview>
  connectCustom(request: CustomConnectRequest): Promise<BotEnvironmentHostState>
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
    previewCustom: (credential) => call((remote) => remote.previewCustom(credential)),
    connectCustom: (request) => call((remote) => remote.connectCustom(request)),
    forget: () => call((remote) => remote.forget()),
    refreshImage: () => call((remote) => remote.refreshImage()),
    startImage: () => call((remote) => remote.startImage()),
    cancelImage: () => call((remote) => remote.cancelImage()),
  }
}
