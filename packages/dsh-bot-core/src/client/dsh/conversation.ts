// Source: dsh-client-ui-conversation/src/client/contract/{snapshot.ts,slots.ts}.
import type { ReactNode } from "react"
import type { SessionListState, Translate } from "./context"
import type { RenderFactory } from "./slots"

/** The `SessionSnapshot` fields the conversation phase reads. */
export interface PhaseSession {
  readonly blank: boolean
  readonly awaitingFirstTurn?: boolean
  readonly running: boolean
  readonly promptAttempted?: boolean
  readonly openState?: string
}

/** The `ConversationSnapshot` field the conversation phase reads. */
export interface PhaseConversation {
  readonly activeTargets: ReadonlySet<string>
}

/** A selector hook (`SnapshotSelectorHook`). */
export type Select<S> = <T>(selector: (value: S) => T) => T

/** The props a `main.conversation` entry receives (session-maybe scope), as far as bot-core reads them. */
export interface MainConversationSlotProps {
  readonly t: Translate
  readonly sessionId: string | undefined
  readonly useSession: Select<PhaseSession | undefined>
  readonly useConversation: Select<PhaseConversation | undefined>
  readonly useSessions: Select<SessionListState>
  readonly renderFactorySlot: RenderFactory
}

/** `ComposerChainProps`, the `conversation.composer` chain's owner, as far as bot-core reads it. */
export interface ComposerChainOwner {
  readonly sessionId: string | undefined
  readonly pendingInteraction: { readonly kind: string } | undefined
}

/** `ConversationContentInputProps` of the `conversation.content` Factory, main variant. */
export interface ConversationContentInput {
  readonly variant: "main"
  readonly phase: "settling" | "hero" | "active"
  readonly hero: boolean
}

/** The `views` local Component's props of `conversation.content`. */
export interface ConversationViewsProps {
  renderSlot(key: string, owner: object): ReactNode
}
