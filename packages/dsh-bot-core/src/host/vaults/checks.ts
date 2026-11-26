import type {
  GuardArgumentsRequest,
  GuardArgumentsVerdict,
  GuardResultRequest,
  GuardResultVerdict,
} from "../../internal"
import { type GuardFinding, GuardStaleError, type VaultGuard } from "./guard"

export interface VaultChecksDeps {
  guard: Pick<VaultGuard, "guards" | "scan" | "record">
  sessionOf(agentId: string): string | undefined
  warn(message: string): void
}

export interface VaultChecks {
  guards(botId: string): boolean
  toolArguments(botId: string, request: GuardArgumentsRequest): Promise<GuardArgumentsVerdict>
  toolResult(botId: string, request: GuardResultRequest): Promise<GuardResultVerdict>
  assistantMessage(botId: string, sessionId: string, content: unknown): Promise<void>
}

const UNCHECKED = "the vault guard could not check it"

const names = (findings: readonly GuardFinding[]) =>
  [...new Set(findings.map((finding) => `${finding.label} (${finding.kind})`))].join(", ")

const failure = (error: unknown) => (error instanceof GuardStaleError ? error.message : UNCHECKED)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createVaultChecks(deps: VaultChecksDeps): VaultChecks {
  const subject = (botId: string, agentId: string, tool?: string) => {
    const sessionId = deps.sessionOf(agentId)
    return {
      botId,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(tool === undefined ? {} : { tool }),
    }
  }
  return {
    guards: (botId) => deps.guard.guards(botId),
    async toolArguments(botId, request) {
      if (!deps.guard.guards(botId)) return { kind: "allow" }
      let scan: Awaited<ReturnType<VaultGuard["scan"]>>
      try {
        scan = await deps.guard.scan(botId, request.args)
      } catch (error) {
        return { kind: "deny", reason: `${request.tool} did not run: ${failure(error)}` }
      }
      if (!scan.changed) return { kind: "allow" }
      if (scan.findings.length === 0) {
        return {
          kind: "deny",
          reason: `these arguments are too long for the vault guard to check, so ${request.tool} did not run`,
        }
      }
      try {
        await deps.guard.record(
          subject(botId, request.agentId, request.tool),
          "tool-arguments",
          "exposed",
          scan.findings,
        )
      } catch (error) {
        deps.warn(
          `bot-core: an incident of bot "${botId}" could not be stored: ${messageOf(error)}`,
        )
      }
      return {
        kind: "deny",
        reason: `these arguments hold the secret of ${names(scan.findings)}, so ${request.tool} did not run and your owner was told. Never write a secret: fill logins with the connectors' credential tools.`,
      }
    },
    async toolResult(botId, request) {
      if (!deps.guard.guards(botId)) return { kind: "clean" }
      try {
        const scan = await deps.guard.scan(botId, {
          result: request.result,
          decision: request.decision,
        })
        if (!scan.changed) return { kind: "clean" }
        if (scan.findings.length > 0) {
          await deps.guard.record(
            subject(botId, request.agentId, request.tool),
            "tool-result",
            "redacted",
            scan.findings,
          )
        }
        return { kind: "withheld", result: scan.redacted.result, decision: scan.redacted.decision }
      } catch (error) {
        return { kind: "failed", reason: failure(error) }
      }
    },
    async assistantMessage(botId, sessionId, content) {
      if (!deps.guard.guards(botId)) return
      try {
        const scan = await deps.guard.scan(botId, content)
        if (scan.changed && scan.findings.length > 0) {
          await deps.guard.record(
            { botId, sessionId },
            "assistant-message",
            "exposed",
            scan.findings,
          )
        }
      } catch (error) {
        deps.warn(
          `bot-core: a message of bot "${botId}" could not be checked for its secrets: ${failure(error)}`,
        )
      }
    },
  }
}
