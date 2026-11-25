/**
 * What the vault guard row hands back to dsh-tools after the guard looked at
 * a call's outcome (docs/specs/bot-vaults.md §7.2): unchanged when clean; a
 * successful result whose value held the secret is replaced through its
 * value (re-rendered and checked against the tool's output, so neither its
 * content nor its value keeps a secret); anything else (a secret only in the
 * content, a failure, a context) is blocked with the withheld content.
 */
import type { PostToolDecision, PreToolDecision, ToolExecutionResult } from "@deepseek-ai/dsh-tools"
import type { GuardArgumentsVerdict, GuardResultVerdict } from "../../internal"

const WITHHELD_INFO = { name: "VaultGuard", code: "SECRET_WITHHELD" }
const FAILED_INFO = { name: "VaultGuard", code: "VAULT_GUARD_FAILED" }
const DENIED_INFO = { name: "VaultGuard", code: "SECRET_IN_ARGUMENTS" }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function postDecision(
  verdict: GuardResultVerdict,
  result: Readonly<ToolExecutionResult>,
  decision: PostToolDecision,
): PostToolDecision {
  switch (verdict.kind) {
    case "clean":
      return decision
    case "failed":
      return {
        kind: "block",
        feedback: [
          {
            type: "text",
            text: `Error: this result was withheld because the vault guard could not check it (${verdict.reason}).`,
          },
        ],
        info: FAILED_INFO,
      }
    case "withheld": {
      const redacted = verdict.result
      const redactedDecision = verdict.decision
      if (redactedDecision.kind === "block") {
        return {
          kind: "block",
          feedback: redactedDecision.feedback,
          info: redactedDecision.info ?? WITHHELD_INFO,
        }
      }
      const contextsChanged =
        !same(redacted.additionalContexts, result.additionalContexts) ||
        !same(redactedDecision.additionalContexts, decision.additionalContexts)
      const value = redactedDecision.value !== undefined ? redactedDecision.value : redacted.value
      const original =
        decision.kind === "accept" && decision.value !== undefined ? decision.value : result.value
      const valueChanged = !same(value, original)
      if (redacted.isError || contextsChanged || !valueChanged) {
        return {
          kind: "block",
          feedback: redactedDecision.content ?? redacted.content,
          info: redacted.isError ? (redacted.error.info ?? WITHHELD_INFO) : WITHHELD_INFO,
        }
      }
      return {
        kind: "accept",
        value,
        ...(decision.additionalContexts === undefined
          ? {}
          : { additionalContexts: decision.additionalContexts }),
      }
    }
  }
}

export function preDecision(verdict: GuardArgumentsVerdict): PreToolDecision | undefined {
  return verdict.kind === "allow"
    ? undefined
    : { kind: "deny", reason: verdict.reason, info: DENIED_INFO }
}
