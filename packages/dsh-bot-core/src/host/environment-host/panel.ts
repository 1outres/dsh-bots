import type { BotEnvironmentHost } from "../../contract"
import type {
  BotEnvironmentHostState,
  CustomPreview,
  EnvironmentHostView,
} from "../../shared/environment-host"
import type { BotEnvironmentImageHost } from "../../shared/environment-image"
import type {
  HostKeyScan,
  SetupBrief,
  SetupInspection,
  SetupInvestigation,
  SshIdentityView,
} from "../../shared/vm-host-setup"
import type { EnvironmentKeeper } from "../environment"
import {
  parseCustomConnectRequest,
  parseCustomCredential,
  parseIdentityRemoval,
  parseJobId,
  parseSetupInspectRequest,
  parseSetupStartRequest,
  parseSshTarget,
} from "./input"

export interface EnvironmentHostPanel {
  state(): BotEnvironmentHostState
  subscribe(listener: () => void): () => void
  check(): Promise<BotEnvironmentHostState>
  previewCustom(credential: unknown): CustomPreview
  connectCustom(request: unknown): Promise<BotEnvironmentHostState>
  setupIdentity(): Promise<SshIdentityView>
  removeSetupIdentity(scope: unknown): Promise<SshIdentityView>
  scanHostKey(target: unknown, signal?: AbortSignal): Promise<HostKeyScan>
  inspectSetup(request: unknown, signal?: AbortSignal): Promise<SetupInspection>
  startSetup(request: unknown): Promise<BotEnvironmentHostState>
  cancelSetup(jobId: unknown): Promise<BotEnvironmentHostState>
  dismissSetup(jobId: unknown): Promise<BotEnvironmentHostState>
  investigateSetup(jobId: unknown): Promise<SetupInvestigation>
  forget(): Promise<BotEnvironmentHostState>
  refreshImage(): Promise<BotEnvironmentHostState>
  startImage(): Promise<BotEnvironmentHostState>
  cancelImage(): Promise<BotEnvironmentHostState>
}

export interface EnvironmentHostPanelDeps {
  readonly environment: Pick<EnvironmentKeeper, "current" | "onRegistration">
  readonly pluginVersion: string
  botName(botId: string): string | undefined
  onBots(listener: () => void): () => void
  investigate(brief: SetupBrief): Promise<SetupInvestigation>
}

export function createEnvironmentHostPanel(deps: EnvironmentHostPanelDeps): EnvironmentHostPanel {
  const hostOf = (): BotEnvironmentHost | undefined => deps.environment.current()?.host
  const required = (): BotEnvironmentHost => {
    const host = hostOf()
    if (host === undefined) throw new Error("no registered bot environment has a VM host to choose")
    return host
  }
  const imageOf = (): BotEnvironmentImageHost => {
    const image = required().image
    if (image === undefined) throw new Error("the bot environment does not import its base image")
    return image
  }
  const stateOf = (view: EnvironmentHostView): BotEnvironmentHostState => ({
    status: "ready",
    host: {
      ...view,
      egress: view.egress.flatMap((report) => {
        const botName = deps.botName(report.botId)
        return botName === undefined ? [] : [{ ...report, botName }]
      }),
    },
    pluginVersion: deps.pluginVersion,
  })
  const state = (): BotEnvironmentHostState => {
    const host = hostOf()
    return host === undefined ? { status: "none" } : stateOf(host.view())
  }
  return {
    state,
    subscribe(listener) {
      let offHost = hostOf()?.subscribe(listener)
      const offRegistration = deps.environment.onRegistration(() => {
        offHost?.()
        offHost = hostOf()?.subscribe(listener)
        listener()
      })
      const offBots = deps.onBots(listener)
      return () => {
        offRegistration()
        offBots()
        offHost?.()
      }
    },
    check: async () => stateOf(await required().check()),
    previewCustom: (credential) => required().custom.preview(parseCustomCredential(credential)),
    connectCustom: async (request) =>
      stateOf(await required().custom.connect(parseCustomConnectRequest(request))),
    setupIdentity: async () => required().setup.identity(),
    removeSetupIdentity: async (scope) =>
      required().setup.removeIdentity(parseIdentityRemoval(scope)),
    scanHostKey: async (target, signal) =>
      required().setup.scanHostKey(parseSshTarget(target), signal),
    inspectSetup: async (request, signal) =>
      required().setup.inspect(parseSetupInspectRequest(request), signal),
    async startSetup(request) {
      const host = required()
      host.setup.start(parseSetupStartRequest(request))
      return stateOf(host.view())
    },
    async cancelSetup(jobId) {
      const host = required()
      host.setup.cancel(parseJobId(jobId))
      return stateOf(host.view())
    },
    async dismissSetup(jobId) {
      const host = required()
      host.setup.dismiss(parseJobId(jobId))
      return stateOf(host.view())
    },
    investigateSetup: async (jobId) =>
      deps.investigate(await required().setup.brief(parseJobId(jobId))),
    forget: async () => stateOf(await required().forget()),
    async refreshImage() {
      await imageOf().refresh()
      return state()
    },
    async startImage() {
      imageOf().start()
      return state()
    },
    async cancelImage() {
      imageOf().cancel()
      return state()
    },
  }
}
