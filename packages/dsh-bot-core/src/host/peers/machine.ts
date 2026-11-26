import type { BotPeerMachine } from "../../internal"
import type { EnvironmentStatus } from "../environment"

export function peerMachineOf(status: EnvironmentStatus): BotPeerMachine {
  if (status.ready) return "ready"
  return status.pending === true ? "starting" : "stopped"
}
