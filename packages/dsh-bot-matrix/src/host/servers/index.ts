import type { BotChannelChoice } from "@1outres/dsh-bot-core"
import type { MatrixServer } from "./server"
import { SYNAPSE } from "./synapse"
import { TUWUNEL } from "./tuwunel"

export type { MatrixRetirement, MatrixServer, MatrixServerIdentity } from "./server"

export const MATRIX_SERVERS = {
  synapse: SYNAPSE,
  tuwunel: TUWUNEL,
} as const satisfies Readonly<Record<string, MatrixServer>>

export type MatrixServerKind = keyof typeof MATRIX_SERVERS

export const SERVER_CHOICES: readonly BotChannelChoice[] = Object.entries(MATRIX_SERVERS).map(
  ([value, server]) => ({ value, label: server.label }),
)

export function serverOf(kind: string): MatrixServer {
  const server = (MATRIX_SERVERS as Readonly<Record<string, MatrixServer>>)[kind]
  if (server === undefined) throw new Error(`"${kind}" is not a homeserver this channel knows`)
  return server
}
