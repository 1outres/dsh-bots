import type { MainInputState } from "../../shared/main-input"
import { EMPTY_DRAFT, type MainDraft, sendableOf } from "./draft"

export type ComposerConnection =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly state: MainInputState }
  | { readonly status: "reconnecting"; readonly state: MainInputState }
  | { readonly status: "failed"; readonly message: string }

export interface ComposerState {
  readonly connection: ComposerConnection
  readonly draft: MainDraft
  readonly sending: boolean
  readonly stopping: boolean
  readonly notice?: string
}

export const INITIAL_COMPOSER: ComposerState = {
  connection: { status: "loading" },
  draft: EMPTY_DRAFT,
  sending: false,
  stopping: false,
}

export const stateReceived = (composer: ComposerState, state: MainInputState): ComposerState => ({
  ...composer,
  connection: { status: "ready", state },
})

export function connectionLost(
  composer: ComposerState,
  message: string | undefined,
): ComposerState {
  const { connection } = composer
  return {
    ...composer,
    connection:
      connection.status === "ready" || connection.status === "reconnecting"
        ? { status: "reconnecting", state: connection.state }
        : { status: "failed", message: message ?? "The connection was lost." },
  }
}

export const inputStateOf = (composer: ComposerState): MainInputState | undefined =>
  composer.connection.status === "ready" || composer.connection.status === "reconnecting"
    ? composer.connection.state
    : undefined

export const noticed = (composer: ComposerState, notice: string): ComposerState => ({
  ...composer,
  notice,
})

export function withoutNotice(composer: ComposerState): ComposerState {
  if (composer.notice === undefined) return composer
  const { notice: _, ...rest } = composer
  return rest
}

export type ComposerAvailability =
  | { readonly kind: "ready"; readonly state: MainInputState }
  | { readonly kind: "unavailable"; readonly reason: "connecting" | "no-main" | "failed" }

export function availabilityOf(composer: ComposerState): ComposerAvailability {
  const { connection } = composer
  switch (connection.status) {
    case "loading":
    case "reconnecting":
      return { kind: "unavailable", reason: "connecting" }
    case "failed":
      return { kind: "unavailable", reason: "failed" }
    case "ready":
      return connection.state.mainSessionId === undefined
        ? { kind: "unavailable", reason: "no-main" }
        : { kind: "ready", state: connection.state }
  }
}

export type PrimaryAction =
  | { readonly kind: "send"; readonly enabled: boolean }
  | { readonly kind: "stop"; readonly enabled: boolean }
  | { readonly kind: "sending" }

export function primaryActionOf(composer: ComposerState, locked: boolean): PrimaryAction {
  if (composer.sending) return { kind: "sending" }
  const availability = availabilityOf(composer)
  const running = availability.kind === "ready" && availability.state.activity === "running"
  const sendable = sendableOf(composer.draft)
  if (running && sendable.ok === false && sendable.reason === "empty") {
    return { kind: "stop", enabled: !composer.stopping }
  }
  return {
    kind: "send",
    enabled: !locked && availability.kind === "ready" && sendable.ok,
  }
}
