import type {
  BotChannelCheck,
  BotChannelConnectionState,
  BotChannelDescriptor,
  BotChannelField,
  BotChannelInspection,
  BotChannelListField,
  BotChannelOptions,
  BotChannelProfileSupport,
  BotChannelPublicValues,
  BotChannelText,
} from "./shared/channels"
import type {
  ConnectorActionView,
  ConnectorDecision,
  ConnectorDecisionResult,
} from "./shared/connectors"
import type {
  BotAnswerResult,
  BotInteraction,
  BotInteractionAnswer,
  BotInteractionClosure,
  BotInteractionKind,
} from "./shared/interactions"
import type { SenderAnswerResult, SenderChoice, SenderInquiryView } from "./shared/senders"
import type { VaultIncidentView } from "./shared/vaults"

export type * from "./shared/interactions"

export type BotChannelValuesOf<F extends readonly BotChannelField[]> = {
  readonly [Field in F[number] as Field["key"]]: Field extends { readonly kind: "list" }
    ? readonly string[]
    : string
}

export interface BotChannel<F extends readonly BotChannelField[] = readonly BotChannelField[]>
  extends BotChannelDescriptor {
  readonly fields: F
  readonly owners?: BotChannelListKey<F>
  readonly capabilities: BotChannelCapabilities
  readonly settingsVersion?: number
  upgradeSettings?(stored: BotChannelStoredSettings): BotChannelSettingsUpgrade
  options?(request: BotChannelOptionsRequest<BotChannelValuesOf<F>>): Promise<BotChannelOptions>
  check?(request: BotChannelSettingsRequest<BotChannelValuesOf<F>>): Promise<BotChannelCheck>
  inspect?(request: BotChannelSettingsRequest<BotChannelValuesOf<F>>): Promise<BotChannelInspection>
  readonly formatHint?: string
  connect(link: BotChannelLink<BotChannelValuesOf<F>>): BotChannelConnection
}

export interface BotChannelStoredSettings {
  readonly version: number
  readonly values: BotChannelPublicValues
}

export interface BotChannelSettingsUpgrade {
  readonly values: BotChannelPublicValues
  readonly notes: readonly string[]
}

export interface BotChannelSettingsRequest<V = BotChannelValuesOf<readonly BotChannelField[]>> {
  readonly bot?: { readonly id: string; readonly name: string }
  readonly settings: V
  readonly signal: AbortSignal
}

export interface BotChannelOptionsRequest<V = BotChannelValuesOf<readonly BotChannelField[]>>
  extends BotChannelSettingsRequest<V> {
  readonly source: string
}

export type BotChannelListKey<F extends readonly BotChannelField[]> = Extract<
  F[number],
  BotChannelListField
>["key"]

export interface BotChannelCapabilities {
  readonly attachments?: BotAttachmentCapability
  readonly files?: BotFileCapability
  readonly turns: boolean
  readonly interactions: readonly BotInteractionKind[]
  readonly commands: readonly BotCommandId[]
  readonly connectorActions?: true
  readonly credentialIncidents?: true
  readonly profile?: BotChannelProfileSupport
  readonly senderInquiries?: true
}

export interface BotAttachmentCapability {
  readonly maxCount: number
  readonly maxBytes: number
}

export interface BotFileCapability {
  readonly maxBytes: number
}

export interface BotChannelConnection {
  receive(output: BotChannelOutput): Promise<void>
  close(): Promise<void>
}

export type BotChannelOutput =
  | { readonly kind: "reply"; readonly reply: BotReply }
  | { readonly kind: "file"; readonly file: BotOutboundFile }
  | { readonly kind: "turn"; readonly turn: BotTurnState }
  | { readonly kind: "interaction-opened"; readonly interaction: BotInteraction }
  | { readonly kind: "interaction-updated"; readonly interaction: BotInteraction }
  | { readonly kind: "interaction-closed"; readonly closure: BotInteractionClosure }
  | { readonly kind: "connector-action"; readonly action: ConnectorActionView }
  | { readonly kind: "credential-incident"; readonly incident: VaultIncidentView }
  | { readonly kind: "profile"; readonly profile: BotChannelProfile }
  | { readonly kind: "sender-inquiry"; readonly inquiry: SenderInquiryView }

export interface BotProfileImage {
  readonly mediaType: "image/png"
  readonly size: number
  readonly data: Uint8Array
  readonly digest: string
}

export interface BotChannelProfile {
  readonly digest: string
  readonly name?: string
  readonly avatar?: BotProfileImage
}

export type BotChannelProfileReport =
  | { readonly digest: string; readonly state: "synced" }
  | {
      readonly digest: string
      readonly state: "failed"
      readonly problems: readonly BotChannelText[]
    }

export interface BotReply {
  readonly id: string
  readonly text: string
  readonly interrupted: boolean
}

export interface BotOutboundFile {
  readonly name: string
  readonly data: Uint8Array
  readonly caption?: string
}

export type BotTurnState =
  | { readonly phase: "started" }
  | { readonly phase: "completed" }
  | { readonly phase: "failed"; readonly message: string }
  | { readonly phase: "cancelled"; readonly by: "user" | "system" }

export type BotActivity = "idle" | "running"

export type BotDeliveryMode = "queue" | "steer"

export type BotMessagePlace =
  | { readonly kind: "direct" }
  | { readonly kind: "channel"; readonly channel: string; readonly server: string }

export interface BotMessageSender {
  readonly id: string
  readonly displayName: string
  readonly handle: string
  readonly bot: boolean
}

export interface BotInboundMessage {
  readonly place: BotMessagePlace
  readonly sender: BotMessageSender
  readonly sentAt: number
  readonly text: string
  readonly attachments: readonly BotInboundAttachment[]
}

export interface BotInboundAttachment {
  readonly name: string
  readonly mediaType?: string
  readonly bytes: number
  read(maxBytes: number, signal: AbortSignal): Promise<Uint8Array>
}

export interface BotDeliveryReceipt {
  readonly sessionId: string
  readonly mode: BotDeliveryMode
  readonly images: number
  readonly saved: readonly string[]
}

export type BotDeliveryFailureCode =
  | "closed"
  | "empty"
  | "no-main-session"
  | "too-many-attachments"
  | "too-large"
  | "unreadable"
  | "environment-unavailable"
  | "save-failed"
  | "rejected"

export interface BotDeliveryFailure {
  readonly code: BotDeliveryFailureCode
  readonly message: string
}

export type BotDeliveryResult =
  | { readonly delivered: true; readonly receipt: BotDeliveryReceipt }
  | { readonly delivered: false; readonly failure: BotDeliveryFailure }

export type BotCommandId = "stop" | "status" | "new"

export type BotCommandAccess = "anyone" | "owners"

export interface BotCommandSpec {
  readonly id: BotCommandId
  readonly description: BotChannelText
  readonly access: BotCommandAccess
}

export interface BotConversationStatus {
  readonly activity: BotActivity
  readonly loaded: boolean
  readonly model?: {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
  }
  readonly queued: number
}

export type BotCommandResult =
  | { readonly command: "stop"; readonly outcome: "stopped" | "idle" }
  | { readonly command: "status"; readonly status: BotConversationStatus }
  | { readonly command: "new"; readonly outcome: "started" | "unchanged" }

export type BotCommandOutcome =
  | { readonly ok: true; readonly result: BotCommandResult }
  | { readonly ok: false; readonly message: string }

export type BotPendingActionsResult =
  | { readonly ok: true; readonly actions: readonly ConnectorActionView[] }
  | { readonly ok: false; readonly reason: "not-approver" | "closed" }

export type BotPendingSenderInquiriesResult =
  | { readonly ok: true; readonly inquiries: readonly SenderInquiryView[] }
  | { readonly ok: false; readonly reason: "not-approver" | "closed" }

export interface BotChannelLink<V = BotChannelValuesOf<readonly BotChannelField[]>> {
  readonly bot: { readonly id: string; readonly name: string }
  readonly settings: V
  readonly signal: AbortSignal
  readonly commands: readonly BotCommandSpec[]
  deliver(message: BotInboundMessage): Promise<BotDeliveryResult>
  run(command: BotCommandId, person: string): Promise<BotCommandOutcome>
  answer(interactionId: string, answer: BotInteractionAnswer): Promise<BotAnswerResult>
  hold(interactionId: string): Promise<BotAnswerResult>
  decide(
    actionId: string,
    decision: ConnectorDecision,
    person: string,
  ): Promise<ConnectorDecisionResult>
  pendingActions(person: string): BotPendingActionsResult
  openActions(): readonly ConnectorActionView[]
  connectorAction(actionId: string): ConnectorActionView | undefined
  answerSender(inquiryId: string, choice: SenderChoice, person: string): Promise<SenderAnswerResult>
  pendingSenderInquiries(person: string): BotPendingSenderInquiriesResult
  openSenderInquiries(): readonly SenderInquiryView[]
  senderInquiry(inquiryId: string): SenderInquiryView | undefined
  activity(): BotActivity
  report(state: BotChannelConnectionState): void
  reportProfile(report: BotChannelProfileReport): void
}
