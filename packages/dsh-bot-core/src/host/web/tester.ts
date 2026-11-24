import type { BotWebTestResult } from "../../shared/web"
import type { BotWebBackend } from "../../web-contract"

export interface WebTesterDeps {
  /** A signal that aborts after `ms`. */
  deadline(ms: number): AbortSignal
  /** Default 15 s. */
  readonly timeoutMs?: number
}

/** One connection test at a time. */
export interface WebTester {
  readonly busy: boolean
  /** @throws only when a test is already running. */
  run(backend: BotWebBackend, secrets: Readonly<Record<string, string>>): Promise<BotWebTestResult>
}

export const WEB_TEST_TIMEOUT_MS = 15_000

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createWebTester(deps: WebTesterDeps): WebTester {
  const timeoutMs = deps.timeoutMs ?? WEB_TEST_TIMEOUT_MS
  let running = false
  return {
    get busy() {
      return running
    },
    async run(backend, secrets) {
      if (running) throw new Error("a connection test is already running")
      running = true
      const signal = deps.deadline(timeoutMs)
      try {
        return await backend.test({ secrets, signal })
      } catch (error) {
        return signal.aborted
          ? {
              ok: false,
              reason: "unreachable",
              message: `no answer within ${timeoutMs / 1000} seconds`,
            }
          : { ok: false, reason: "unexpected", message: describe(error) }
      } finally {
        running = false
      }
    },
  }
}
