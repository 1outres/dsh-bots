import type { BotChannelText } from "@1outres/dsh-bot-core"
import type { MatrixApi } from "../matrix"

export interface MatrixServerIdentity {
  readonly version: string
}

export type MatrixRetirement =
  | { readonly kind: "deactivated" }
  | { readonly kind: "vacated"; readonly note: BotChannelText }

export interface MatrixServer {
  readonly label: BotChannelText
  readonly registrationGuide: BotChannelText
  readonly retirementNote?: BotChannelText
  identify(api: MatrixApi, signal: AbortSignal): Promise<MatrixServerIdentity | undefined>
  retire(api: MatrixApi, signal: AbortSignal): Promise<MatrixRetirement>
}
