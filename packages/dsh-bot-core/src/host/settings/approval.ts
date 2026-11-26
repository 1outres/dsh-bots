import type { BotChannelText } from "../../shared/channels"
import type { BotAnswerOrigin } from "../../shared/interactions"
import type { BotSettingApprover } from "../../shared/settings"
import type { InteractionBoard, InteractionPlace } from "../interactions/board"

export interface SettingsApprovalRequest {
  readonly place: InteractionPlace
  readonly question: BotChannelText
  readonly detail: BotChannelText
  readonly signal: AbortSignal
}

export type SettingsApprovalOutcome =
  | { readonly kind: "approved"; readonly by: BotSettingApprover }
  | { readonly kind: "rejected" }
  | { readonly kind: "withdrawn" }

export interface SettingsApprovals {
  ask(request: SettingsApprovalRequest): Promise<SettingsApprovalOutcome>
}

export const SETTINGS_APPROVAL_SUBJECT = "bot_settings"

const CHANGE_LABEL: BotChannelText = { en: "Change", ja: "変更する" }

export function createSettingsApprovals(deps: {
  board: Pick<InteractionBoard, "open">
  channelName(channelId: string): string | undefined
}): SettingsApprovals {
  const approverOf = (origin: BotAnswerOrigin): BotSettingApprover | undefined => {
    switch (origin.via) {
      case "web":
        return { kind: "web" }
      case "channel":
        return {
          kind: "channel",
          channelId: origin.channelId,
          channelName: deps.channelName(origin.channelId) ?? origin.channelId,
        }
      case "main":
        return undefined
    }
  }
  return {
    ask({ place, question, detail, signal }) {
      if (signal.aborted) return Promise.resolve({ kind: "withdrawn" })
      return new Promise((resolve) => {
        let settled = false
        const settle = (outcome: SettingsApprovalOutcome) => {
          if (settled) return false
          settled = true
          signal.removeEventListener("abort", abort)
          resolve(outcome)
          return true
        }
        const opened = deps.board.open(
          place,
          (id) => ({
            id,
            kind: "approval",
            subject: SETTINGS_APPROVAL_SUBJECT,
            question,
            detail,
            actions: ["allow-once", "reject"],
            allowLabel: CHANGE_LABEL,
            delegated: false,
          }),
          {
            async answer(answer, origin) {
              if (answer.kind !== "approval") {
                return { accepted: false, reason: "invalid", message: "This needs an approval." }
              }
              const by = approverOf(origin)
              if (by === undefined) {
                return {
                  accepted: false,
                  reason: "invalid",
                  message: "A change of the bot's settings is approved by its owner only.",
                }
              }
              const outcome: SettingsApprovalOutcome =
                answer.action === "allow-once" ? { kind: "approved", by } : { kind: "rejected" }
              return settle(outcome)
                ? { accepted: true }
                : {
                    accepted: false,
                    reason: "not-open",
                    message: "This is no longer waiting for an answer.",
                  }
            },
          },
        )
        const abort = () => {
          if (settle({ kind: "withdrawn" })) opened.withdraw()
        }
        signal.addEventListener("abort", abort, { once: true })
      })
    },
  }
}
