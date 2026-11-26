import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import type { BotEnvironmentHost } from "../../contract"
import type {
  BotEnvironmentHostState,
  CustomConnectRequest,
  CustomCredential,
  CustomPreview,
  EnvironmentHostView,
} from "../../shared/environment-host"
import type { BotEnvironmentImageHost } from "../../shared/environment-image"
import type { EnvironmentKeeper } from "../environment"

export interface EnvironmentHostPanel {
  state(): BotEnvironmentHostState
  subscribe(listener: () => void): () => void
  check(): Promise<BotEnvironmentHostState>
  previewCustom(credential: unknown): CustomPreview
  connectCustom(request: unknown): Promise<BotEnvironmentHostState>
  forget(): Promise<BotEnvironmentHostState>
  refreshImage(): Promise<BotEnvironmentHostState>
  startImage(): Promise<BotEnvironmentHostState>
  cancelImage(): Promise<BotEnvironmentHostState>
}

export interface EnvironmentHostPanelDeps {
  readonly environment: Pick<EnvironmentKeeper, "current" | "onRegistration">
  botName(botId: string): string | undefined
  onBots(listener: () => void): () => void
}

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

function recordOf(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad(`${what} must be an object`)
  }
  return value as Record<string, unknown>
}

export function parseCustomCredential(value: unknown): CustomCredential {
  const record = recordOf(value, "credential")
  switch (record.backend) {
    case "incus":
      return {
        backend: "incus",
        trustToken: text(record.trustToken, "trustToken", MAX_TRUST_TOKEN_LENGTH),
      }
    case "proxmox":
      return {
        backend: "proxmox",
        url: text(record.url, "url"),
        tokenId: text(record.tokenId, "tokenId"),
        serverFingerprint: text(record.serverFingerprint, "serverFingerprint"),
      }
    default:
      throw bad("credential.backend must be incus or proxmox")
  }
}

export function parseCustomConnectRequest(value: unknown): CustomConnectRequest {
  const record = recordOf(value, "request")
  switch (record.backend) {
    case "incus":
      return {
        backend: "incus",
        token: text(record.token, "token", MAX_TRUST_TOKEN_LENGTH),
        url: text(record.url, "url"),
        project: text(record.project, "project"),
      }
    case "proxmox":
      return {
        backend: "proxmox",
        url: text(record.url, "url"),
        tokenId: text(record.tokenId, "tokenId"),
        tokenSecret: text(record.tokenSecret, "tokenSecret"),
        serverFingerprint: text(record.serverFingerprint, "serverFingerprint"),
        node: text(record.node, "node"),
        pool: text(record.pool, "pool"),
      }
    default:
      throw bad("request.backend must be incus or proxmox")
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
    previewCustom: (credential) => required().custom.preview(parseCustomCredential(credential)),
    connectCustom: async (request) =>
      stateOf(await required().custom.connect(parseCustomConnectRequest(request))),
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
