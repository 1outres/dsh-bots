import type { MainRotationReason } from "./shared/mains"

/**
 * The preparation stage of a Main's maintenance (docs/specs/bot-main-rotation.md §9):
 * bot-core decides to compact the Main or to replace it, then hands the
 * decision to every registered {@link MainPreparation}, one after another,
 * and carries it out only if all of them resolved and the Main is still idle.
 */

/** What bot-core is about to do to the Main. */
export type MainMaintenance =
  | { readonly kind: "compact" }
  | { readonly kind: "rotate"; readonly reason: MainRotationReason }

/** How a maintenance turn ended. */
export type MainTurnResult =
  | { readonly ended: "completed" }
  | { readonly ended: "failed" | "cancelled"; readonly message: string }

/** A maintenance turn's prompt: a notice the Main reads, its summary shown in the Web UI. */
export interface MainTurnPrompt {
  readonly text: string
  readonly summary: string
}

export interface MainPreparationRequest {
  readonly bot: { readonly id: string; readonly name: string }
  /** The Main the maintenance is for. */
  readonly sessionId: string
  readonly maintenance: MainMaintenance
  /**
   * An input waits for the maintenance (the first input after a long idle
   * time): it reaches the Main only once the maintenance ended or was given up.
   */
  readonly holdingInput: boolean
  /** Aborts once the maintenance's time is up or bot-core unloads. */
  readonly signal: AbortSignal
  /**
   * Run one maintenance turn in the Main and wait until it ended and the
   * Agent left it (became idle, or started its next turn). Nothing of it
   * reaches the channels (neither replies nor turn states) and it does not
   * count as the user's activity. Rejects while an earlier maintenance turn
   * of the Main still runs.
   */
  runTurn(prompt: MainTurnPrompt): Promise<MainTurnResult>
}

/** One participant of the preparation stage, registered with `Bot.registerMainPreparation`. */
export interface MainPreparation {
  /** Unique among the registered preparations. */
  readonly id: string
  /** Lower runs first. */
  readonly order: number
  /** A rejection gives the maintenance up this time. */
  prepare(request: MainPreparationRequest): Promise<void>
}
