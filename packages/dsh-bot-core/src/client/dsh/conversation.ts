import type { ReactNode } from "react"
import type { SessionListState, Translate } from "./context"
import type { RenderFactory } from "./slots"

export interface PhaseSession {
  readonly blank: boolean
  readonly awaitingFirstTurn?: boolean
  readonly running: boolean
  readonly promptAttempted?: boolean
  readonly openState?: string
}

export interface PhaseConversation {
  readonly activeTargets: ReadonlySet<string>
}

export type Select<S> = <T>(selector: (value: S) => T) => T

export interface MainConversationSlotProps {
  readonly t: Translate
  readonly sessionId: string | undefined
  readonly useSession: Select<PhaseSession | undefined>
  readonly useConversation: Select<PhaseConversation | undefined>
  readonly useSessions: Select<SessionListState>
  readonly renderFactorySlot: RenderFactory
}

export interface ComposerChainOwner {
  readonly sessionId: string | undefined
  readonly pendingInteraction: { readonly kind: string } | undefined
}

export interface ConversationContentInput {
  readonly variant: "main"
  readonly phase: "settling" | "hero" | "active"
  readonly hero: boolean
}

export interface ConversationViewsProps {
  renderSlot(key: string, owner: object): ReactNode
}
