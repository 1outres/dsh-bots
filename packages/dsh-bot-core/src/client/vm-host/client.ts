import type {
  BotEnvironmentHostState,
  CustomConnectRequest,
  CustomCredential,
  CustomPreview,
  IdentityRemoval,
} from "../../shared/environment-host"
import type {
  HostKeyScan,
  SetupInspection,
  SetupInspectRequest,
  SetupStartRequest,
  SshIdentityView,
  SshTarget,
} from "../../shared/vm-host-setup"
import type { Observable } from "../observable"
import type { BotEnvironmentHostRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"
import type { RemoteResult } from "../types"

export interface VmHostClient extends Observable<FeedState<BotEnvironmentHostState>> {
  check(): Promise<BotEnvironmentHostState>
  previewCustom(credential: CustomCredential): Promise<CustomPreview>
  connectCustom(request: CustomConnectRequest): Promise<BotEnvironmentHostState>
  setupIdentity(): Promise<SshIdentityView>
  removeSetupIdentity(scope: IdentityRemoval): Promise<SshIdentityView>
  scanHostKey(target: SshTarget, signal?: AbortSignal): Promise<HostKeyScan>
  inspectSetup(request: SetupInspectRequest, signal?: AbortSignal): Promise<SetupInspection>
  startSetup(request: SetupStartRequest): Promise<BotEnvironmentHostState>
  cancelSetup(jobId: string): Promise<BotEnvironmentHostState>
  dismissSetup(jobId: string): Promise<BotEnvironmentHostState>
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
    setupIdentity: () => call((remote) => remote.setupIdentity()),
    removeSetupIdentity: (scope) => call((remote) => remote.removeSetupIdentity(scope)),
    scanHostKey: (target, signal) => call((remote) => remote.scanHostKey(target, signal)),
    inspectSetup: (request, signal) => call((remote) => remote.inspectSetup(request, signal)),
    startSetup: (request) => call((remote) => remote.startSetup(request)),
    cancelSetup: (jobId) => call((remote) => remote.cancelSetup(jobId)),
    dismissSetup: (jobId) => call((remote) => remote.dismissSetup(jobId)),
    forget: () => call((remote) => remote.forget()),
    refreshImage: () => call((remote) => remote.refreshImage()),
    startImage: () => call((remote) => remote.startImage()),
    cancelImage: () => call((remote) => remote.cancelImage()),
  }
}
