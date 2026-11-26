import type { MainRotationReason } from "./shared/mains"

export type MainMaintenance =
  | { readonly kind: "compact" }
  | { readonly kind: "rotate"; readonly reason: MainRotationReason }

export type MainTurnResult =
  | { readonly ended: "completed" }
  | { readonly ended: "failed" | "cancelled"; readonly message: string }

export interface MainTurnPrompt {
  readonly text: string
  readonly summary: string
}

export interface MainPreparationRequest {
  readonly bot: { readonly id: string; readonly name: string }
  readonly sessionId: string
  readonly maintenance: MainMaintenance
  readonly holdingInput: boolean
  readonly signal: AbortSignal
  runTurn(prompt: MainTurnPrompt): Promise<MainTurnResult>
}

export interface MainPreparation {
  readonly id: string
  readonly order: number
  prepare(request: MainPreparationRequest): Promise<void>
}
