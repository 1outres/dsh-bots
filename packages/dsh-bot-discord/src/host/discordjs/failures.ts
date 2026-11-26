import {
  DiscordAPIError,
  DiscordjsError,
  DiscordjsErrorCodes,
  GatewayCloseCodes,
  RESTJSONErrorCodes,
} from "discord.js"
import type { DiscordFailure, DiscordProfileRefusal } from "../discord"

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function loginFailure(error: unknown): DiscordFailure {
  if (error instanceof DiscordjsError && error.code === DiscordjsErrorCodes.TokenInvalid) {
    return { retryable: false, reason: "Discord rejected the bot token" }
  }
  return { retryable: true, reason: `Could not connect to Discord: ${messageOf(error)}` }
}

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

export function isUnreachable(error: unknown): boolean {
  const code = codeOf(error)
  return typeof code === "number" && UNREACHABLE.has(code)
}

interface FormErrors {
  readonly _errors?: readonly { readonly code?: unknown; readonly message?: unknown }[]
  readonly [field: string]: unknown
}

function formErrorsOf(value: unknown): { readonly code: string; readonly message: string }[] {
  if (typeof value !== "object" || value === null) return []
  const errors = value as FormErrors
  const own = (errors._errors ?? []).flatMap((error) =>
    typeof error.code === "string" && typeof error.message === "string"
      ? [{ code: error.code, message: error.message }]
      : [],
  )
  const nested = Object.entries(errors)
    .filter(([field]) => field !== "_errors")
    .flatMap(([, child]) => formErrorsOf(child))
  return [...own, ...nested]
}

export function profileRefusal(error: unknown): DiscordProfileRefusal | undefined {
  if (!(error instanceof DiscordAPIError)) return undefined
  if (error.status === 429) return { kind: "rate-limited", message: error.message }
  const raw = error.rawError as { readonly errors?: unknown }
  const errors = formErrorsOf(raw.errors)
  if (errors.some((form) => form.code.endsWith("RATE_LIMIT"))) {
    return { kind: "rate-limited", message: errors.map((form) => form.message).join(" ") }
  }
  return {
    kind: "rejected",
    message: errors.length === 0 ? error.message : errors.map((form) => form.message).join(" "),
  }
}

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
