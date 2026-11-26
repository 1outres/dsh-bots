import { type PartyTurn, startedByOf } from "../turns/parties"

export type SettingsParty = "owner" | "other"

export interface SettingsTurn {
  readonly startedBy: SettingsParty
  readonly mixed: boolean
}

export interface SettingsTurns {
  of(sessionId: string): SettingsTurn | undefined
}

export function settingsTurnOf(turn: PartyTurn | undefined): SettingsTurn | undefined {
  if (turn === undefined) return undefined
  const startedBy = startedByOf(turn)
  if (startedBy === undefined) return undefined
  return {
    startedBy: startedBy === "owner" ? "owner" : "other",
    mixed: turn.inputs.slice(1).some((party) => party !== "owner"),
  }
}
