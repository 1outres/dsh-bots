import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import type { BotEnvironmentHost } from "../../contract"
import type {
  BotEnvironmentHostState,
  EnvironmentHostPairing,
  EnvironmentHostView,
  TrustTokenPreview,
} from "../../shared/environment-host"
import type { BotEnvironmentImageHost } from "../../shared/environment-image"
import type { EnvironmentKeeper } from "../environment"

/** What the `botEnvironmentHost` Remote serves: the VM host section of the dsh-bots settings. */
export interface EnvironmentHostPanel {
  state(): BotEnvironmentHostState
  /** Called after the registered environment or its VM host changed. */
  subscribe(listener: () => void): () => void
  check(): Promise<BotEnvironmentHostState>
  previewToken(token: unknown): TrustTokenPreview
  pair(pairing: unknown): Promise<BotEnvironmentHostState>
  useLocal(project: unknown): Promise<BotEnvironmentHostState>
  setProject(project: unknown): Promise<BotEnvironmentHostState>
  forget(): Promise<BotEnvironmentHostState>
  refreshImage(): Promise<BotEnvironmentHostState>
  startImage(): Promise<BotEnvironmentHostState>
  cancelImage(): Promise<BotEnvironmentHostState>
}

export interface EnvironmentHostPanelDeps {
  readonly environment: Pick<EnvironmentKeeper, "current" | "onRegistration">
  /** A stored bot's name; undefined before it is stored and once it is gone. */
  botName(botId: string): string | undefined
  /** Called after a bot was stored, renamed or removed. */
  onBots(listener: () => void): () => void
}

/** The longest trust token taken (Incus' are a few hundred characters). */
export const MAX_TRUST_TOKEN_LENGTH = 8192
const MAX_FIELD_LENGTH = 2048

const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

function text(value: unknown, what: string, limit = MAX_FIELD_LENGTH): string {
  if (typeof value !== "string") throw bad(`${what} must be text`)
  const trimmed = value.trim()
  if (trimmed === "") throw bad(`${what} is empty`)
  if (trimmed.length > limit) throw bad(`${what} is longer than ${limit}`)
  return trimmed
}

function parsePairing(value: unknown): EnvironmentHostPairing {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad("pairing must be an object")
  }
  const { token, url, project } = value as Record<string, unknown>
  return {
    token: text(token, "token", MAX_TRUST_TOKEN_LENGTH),
    url: text(url, "url"),
    project: text(project, "project"),
  }
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
    previewToken: (token) => required().previewToken(text(token, "token", MAX_TRUST_TOKEN_LENGTH)),
    pair: async (pairing) => stateOf(await required().pair(parsePairing(pairing))),
    useLocal: async (project) => stateOf(await required().useLocal(text(project, "project"))),
    setProject: async (project) => stateOf(await required().setProject(text(project, "project"))),
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
