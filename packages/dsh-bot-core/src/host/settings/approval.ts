import type { BotChannelText } from "../../shared/channels"
import type { InteractionBoard } from "../interactions/board"
import {
  createOwnerApprovals,
  type OwnerApprovalOutcome,
  type OwnerApprovalRequest,
  type OwnerApprovals,
} from "../interactions/owner-approval"

export type SettingsApprovalRequest = OwnerApprovalRequest

export type SettingsApprovalOutcome = OwnerApprovalOutcome

export type SettingsApprovals = OwnerApprovals

export const SETTINGS_APPROVAL_SUBJECT = "bot_settings"

const CHANGE_LABEL: BotChannelText = { en: "Change", ja: "変更する" }

export function createSettingsApprovals(deps: {
  board: Pick<InteractionBoard, "open">
  channelName(channelId: string): string | undefined
}): SettingsApprovals {
  return createOwnerApprovals({
    ...deps,
    kind: {
      subject: SETTINGS_APPROVAL_SUBJECT,
      allowLabel: CHANGE_LABEL,
      ownerOnly: "A change of the bot's settings is approved by its owner only.",
    },
  })
}
