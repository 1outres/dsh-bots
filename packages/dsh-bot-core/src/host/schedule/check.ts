/**
 * A job's check: `bash -c <command>` in the bot's environment (its VM, as
 * the user its tools run as), in the environment's workspace.
 */
import type { EnvironmentWriteSubprocess } from "../channels/inbox-shell"
import type { RunFailure, ScheduleCheck } from "./domain"
import type { CheckOutput } from "./notice"

/** Standard output the run keeps (its tail). */
export const CHECK_STDOUT_BYTES = 16 * 1024
const CHECK_STDERR_BYTES = 2 * 1024
const GRACE_MS = 2000

/** How the command ended. */
export type CheckResult =
  | {
      readonly kind: "exited"
      readonly exitCode: number | null
      readonly signal: string | null
      readonly stdout: CheckOutput
      readonly stderr: string
    }
  | { readonly kind: "timed-out"; readonly stderr: string }

/** What the run does after its check: exit 0 runs with the output, exit 1 stops quietly, the rest fails. */
export type CheckVerdict =
  | { readonly kind: "fire"; readonly output: CheckOutput }
  | { readonly kind: "quiet" }
  | { readonly kind: "failed"; readonly failure: RunFailure }

export function checkVerdict(result: CheckResult, check: ScheduleCheck): CheckVerdict {
  if (result.kind === "timed-out") {
    return {
      kind: "failed",
      failure: {
        stage: "check",
        message: `it ran longer than ${check.timeoutSeconds} seconds and was stopped`,
        ...(result.stderr === "" ? {} : { stderr: result.stderr }),
      },
    }
  }
  if (result.exitCode === 0) return { kind: "fire", output: result.stdout }
  if (result.exitCode === 1) return { kind: "quiet" }
  return {
    kind: "failed",
    failure: {
      stage: "check",
      message:
        result.exitCode === null
          ? `it was ended by signal ${result.signal ?? "unknown"}`
          : `it exited with code ${result.exitCode} (0 runs the job, 1 skips it quietly)`,
      ...(result.exitCode === null ? {} : { exitCode: result.exitCode }),
      ...(result.stderr === "" ? {} : { stderr: result.stderr }),
    },
  }
}

export interface CheckRunnerDeps {
  /** The bot's environment subprocess and workspace, while it is ready. */
  environmentOf(
    botId: string,
  ): { readonly subprocess: EnvironmentWriteSubprocess; readonly workspace: string } | undefined
  /** A signal that aborts after `ms`. */
  deadline(ms: number): AbortSignal
}

/** @throws when the bot's environment is not ready. */
export type CheckRunner = (botId: string, check: ScheduleCheck) => Promise<CheckResult>

export function createCheckRunner(deps: CheckRunnerDeps): CheckRunner {
  return async (botId, check) => {
    const environment = deps.environmentOf(botId)
    if (environment === undefined) {
      throw new Error("the bot's environment is not ready, so the check could not run")
    }
    const signal = deps.deadline(check.timeoutSeconds * 1000)
    const handle = environment.subprocess.spawn({
      argv: ["bash", "-c", check.command],
      cwd: environment.workspace,
      stdio: {
        stdin: "ignore",
        stdout: { maxBytes: CHECK_STDOUT_BYTES },
        stderr: { maxBytes: CHECK_STDERR_BYTES },
      },
      graceMs: GRACE_MS,
      signal,
    })
    const exit = await handle.done
    const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ""
    if (signal.aborted) return { kind: "timed-out", stderr }
    const stdout = handle.collected.stdout?.readFrom(0)
    return {
      kind: "exited",
      exitCode: exit.exitCode,
      signal: exit.signal,
      stdout: { text: stdout?.text.trimEnd() ?? "", truncated: stdout?.lossy === true },
      stderr,
    }
  }
}
