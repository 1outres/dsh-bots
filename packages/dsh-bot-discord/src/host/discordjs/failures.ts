import {
  DiscordAPIError,
  DiscordjsError,
  DiscordjsErrorCodes,
  GatewayCloseCodes,
  RESTJSONErrorCodes,
} from "discord.js"
import type { DiscordFailure } from "../discord"

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function loginFailure(error: unknown): DiscordFailure {
  if (error instanceof DiscordjsError && error.code === DiscordjsErrorCodes.TokenInvalid) {
    return { retryable: false, reason: "Discord rejected the bot token" }
  }
  return { retryable: true, reason: `Could not connect to Discord: ${messageOf(error)}` }
}

/** A close discord.js does not recover from (`shardDisconnect`). */
export function closeFailure(code: number): DiscordFailure {
  switch (code) {
    case GatewayCloseCodes.AuthenticationFailed:
      return { retryable: false, reason: "Discord rejected the bot token (4004)" }
    case GatewayCloseCodes.DisallowedIntents:
      return {
        retryable: false,
        reason:
          "Discord refused the Gateway intents: a server channel home needs Message Content Intent and Server Members Intent; turn them on in the Developer Portal > Bot > Privileged Gateway Intents (4014)",
      }
    default:
      return { retryable: false, reason: `Discord closed the Gateway for good (${code})` }
  }
}

const UNREACHABLE: ReadonlySet<number> = new Set([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.MissingAccess,
])

const codeOf = (error: unknown): number | string | undefined =>
  error instanceof DiscordAPIError ? error.code : undefined

/** Discord no longer has the message or its channel, or no longer lets this bot reach them. */
export function isUnreachable(error: unknown): boolean {
  const code = codeOf(error)
  return typeof code === "number" && UNREACHABLE.has(code)
}

/** Why Discord refused a pin, when it says. */
export function pinRefusal(error: unknown): "full" | "forbidden" | undefined {
  switch (codeOf(error)) {
    case RESTJSONErrorCodes.MaximumNumberOfPinsReachedForTheChannel:
      return "full"
    case RESTJSONErrorCodes.MissingPermissions:
      return "forbidden"
    default:
      return undefined
  }
}
