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
