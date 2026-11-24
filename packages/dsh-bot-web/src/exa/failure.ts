import { WebError } from "@deepseek-ai/dsh-web"

/** Why a call to Exa got no usable answer. */
export type ExaFailure =
  | { readonly kind: "http"; readonly status: number; readonly detail?: string }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "aborted" }
  | { readonly kind: "too-large"; readonly limit: number }
  | { readonly kind: "malformed"; readonly message: string }

export type ExaTestReason =
  | "invalid-secret"
  | "no-credits"
  | "rate-limited"
  | "unreachable"
  | "unexpected"

export type ExaTestResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ExaTestReason; readonly message: string }

function httpMessage(status: number, detail: string | undefined): string {
  if (status === 401 || status === 403) {
    return `Exa refused the API key (HTTP ${status}). Set a valid key in the dsh-bots settings, Web lookup.`
  }
  if (status === 402) return "The Exa account has no credits left (HTTP 402)."
  if (status === 429) return "Exa rate limited the request (HTTP 429). Retry later."
  return detail === undefined
    ? `Exa API error (HTTP ${status}).`
    : `Exa API error (HTTP ${status}): ${detail}`
}

/** A sentence for a person or the model; never carries the API key. */
export function failureMessage(failure: ExaFailure): string {
  switch (failure.kind) {
    case "http":
      return httpMessage(failure.status, failure.detail)
    case "unreachable":
      return `Exa could not be reached: ${failure.message}`
    case "aborted":
      return "The Exa request was cancelled."
    case "too-large":
      return `Exa's response exceeded ${failure.limit} bytes.`
    case "malformed":
      return `Exa answered with an unexpected response: ${failure.message}`
  }
}

export function failureError(failure: ExaFailure): WebError {
  return new WebError(
    failureMessage(failure),
    failure.kind === "aborted" ? "WEB_ABORTED" : "WEB_PROVIDER_ERROR",
  )
}

export function failureReason(failure: ExaFailure): ExaTestReason {
  switch (failure.kind) {
    case "http":
      if (failure.status === 401 || failure.status === 403) return "invalid-secret"
      if (failure.status === 402) return "no-credits"
      if (failure.status === 429) return "rate-limited"
      return "unexpected"
    case "unreachable":
    case "aborted":
      return "unreachable"
    case "too-large":
    case "malformed":
      return "unexpected"
  }
}
