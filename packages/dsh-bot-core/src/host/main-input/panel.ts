import type { BotAttachmentCapability, BotCommandOutcome } from "../../channel-contract"
import type {
  MainAppendResult,
  MainInputFailure,
  MainInputLimits,
  MainInputState,
  MainInputSubmission,
  MainSendResult,
  MainStageRequest,
  MainStageResult,
  MainStopResult,
} from "../../shared/main-input"
import { deliverToMain, type MainDeliveryDeps, type MainInputSource } from "../channels/delivery"
import type { RemoteCaller } from "../connectors/approvals"
import type { InputStaging } from "./staging"

export const WEB_INPUT_SOURCE_ID = "web"

export interface MainInputDeps {
  readonly delivery: MainDeliveryDeps
  readonly staging: InputStaging
  known(botId: string): boolean
  mainSessionOf(botId: string): string | undefined
  activityOf(sessionId: string): MainInputState["activity"]
  limits(): MainInputLimits
  stop(botId: string): Promise<BotCommandOutcome>
  decodeBase64(data: string): Uint8Array
  now(): number
  readonly signal: AbortSignal
}

export interface MainInputPanel {
  state(caller: RemoteCaller | undefined, botId: string): MainInputState
  stage(caller: RemoteCaller | undefined, botId: string, request: MainStageRequest): MainStageResult
  append(
    caller: RemoteCaller | undefined,
    botId: string,
    attachmentId: string,
    offset: number,
    data: string,
  ): MainAppendResult
  discard(caller: RemoteCaller | undefined, botId: string, attachmentId: string): boolean
  send(
    caller: RemoteCaller | undefined,
    botId: string,
    submission: MainInputSubmission,
  ): Promise<MainSendResult>
  stop(caller: RemoteCaller | undefined, botId: string): Promise<MainStopResult>
}

export function webAttachmentCapability(limits: MainInputLimits): BotAttachmentCapability {
  return { maxCount: limits.maxCount, maxBytes: limits.maxFileBytes }
}

const NOT_OWNER: MainInputFailure = {
  code: "not-owner",
  message: "Only the owner of this DeepSeek Harness writes to a bot's Main session.",
}

const UNKNOWN_BOT: MainInputFailure = { code: "unknown-bot", message: "The bot is not listed." }

class MainInputRefusal extends Error {
  constructor(readonly failure: MainInputFailure) {
    super(failure.message)
  }
}

export function createMainInputPanel(deps: MainInputDeps): MainInputPanel {
  const admitted = (
    caller: RemoteCaller | undefined,
    botId: string,
  ): MainInputFailure | undefined => {
    if (caller?.kind !== "owner") return NOT_OWNER
    if (!deps.known(botId)) return UNKNOWN_BOT
    return undefined
  }
  const source = (): MainInputSource => ({
    id: WEB_INPUT_SOURCE_ID,
    attachments: webAttachmentCapability(deps.limits()),
  })
  return {
    state(caller, botId) {
      const refused = admitted(caller, botId)
      if (refused !== undefined) throw new MainInputRefusal(refused)
      const mainSessionId = deps.mainSessionOf(botId)
      return {
        botId,
        ...(mainSessionId === undefined ? {} : { mainSessionId }),
        activity: mainSessionId === undefined ? "idle" : deps.activityOf(mainSessionId),
        limits: deps.limits(),
      }
    },
    stage(caller, botId, request) {
      const refused = admitted(caller, botId)
      if (refused !== undefined) return { staged: false, failure: refused }
      return deps.staging.stage(botId, request)
    },
    append(caller, botId, attachmentId, offset, data) {
      const refused = admitted(caller, botId)
      if (refused !== undefined) return { appended: false, failure: refused }
      return deps.staging.append(botId, attachmentId, offset, deps.decodeBase64(data))
    },
    discard(caller, botId, attachmentId) {
      if (admitted(caller, botId) !== undefined) return false
      return deps.staging.discard(botId, attachmentId)
    },
    async send(caller, botId, submission) {
      const refused = admitted(caller, botId)
      if (refused !== undefined) return { sent: false, failure: refused }
      const resolved = deps.staging.resolve(botId, submission.attachments)
      if (!resolved.ok) return { sent: false, failure: resolved.failure }
      const result = await deliverToMain(
        deps.delivery,
        {
          botId,
          source: source(),
          header: undefined,
          content: {
            text: submission.text,
            sentAt: deps.now(),
            attachments: resolved.attachments,
          },
        },
        deps.signal,
      )
      if (!result.delivered) return { sent: false, failure: result.failure }
      deps.staging.release(botId, submission.attachments)
      return { sent: true, sessionId: result.receipt.sessionId, mode: result.receipt.mode }
    },
    async stop(caller, botId) {
      const refused = admitted(caller, botId)
      if (refused !== undefined) return { ok: false, message: refused.message }
      const outcome = await deps.stop(botId)
      if (!outcome.ok) return outcome
      if (outcome.result.command !== "stop") {
        throw new Error(`stopping answered "${outcome.result.command}"`)
      }
      return { ok: true, outcome: outcome.result.outcome }
    },
  }
}
