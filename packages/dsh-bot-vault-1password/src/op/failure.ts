export type OpFailureReason =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "unreachable"
  | "timeout"
  | "aborted"
  | "too-large"
  | "failed"

const MESSAGES: Readonly<Record<OpFailureReason, string>> = {
  unauthorized: "1Password did not accept the service account token (revoked, expired or mistyped)",
  forbidden: "the service account may not read this vault or item",
  "not-found": "1Password has no such vault or item for this service account",
  "rate-limited":
    "1Password's rate limit for this service account was reached (Personal and Teams accounts allow 1,000 reads an hour per token); try again later",
  unreachable: "1Password could not be reached",
  timeout: "the 1Password CLI did not answer in time",
  aborted: "the 1Password CLI was stopped",
  "too-large": "the 1Password CLI answered more than this provider reads",
  failed: "the 1Password CLI failed",
}

export class OpFailure extends Error {
  override readonly name = "OpFailure"
  readonly reason: OpFailureReason
  constructor(reason: OpFailureReason, command: string, exitCode?: number) {
    super(
      MESSAGES[reason] +
        " (op " +
        command +
        (reason === "failed" && exitCode !== undefined ? `, exit ${exitCode}` : "") +
        ")",
    )
    this.reason = reason
  }
}

const PATTERNS: readonly (readonly [OpFailureReason, RegExp])[] = [
  ["rate-limited", /\(429\)|too many requests|rate limit/i],
  [
    "unauthorized",
    /\(401\)|unauthori[sz]ed|DecodeSACredentials|invalid (service account )?token|token (is )?(invalid|expired|revoked)|authentication/i,
  ],
  ["forbidden", /\(403\)|forbidden|permission denied|does not have (read )?(access|permission)/i],
  [
    "not-found",
    /\(404\)|isn't an item|isn't a vault|not found|no item|no vault|could not find|does not exist/i,
  ],
  [
    "unreachable",
    /dial tcp|no such host|connection refused|connection reset|i\/o timeout|TLS handshake|network is unreachable|EOF/i,
  ],
]

export function reasonOf(stderr: string): OpFailureReason {
  return PATTERNS.find(([, pattern]) => pattern.test(stderr))?.[0] ?? "failed"
}
