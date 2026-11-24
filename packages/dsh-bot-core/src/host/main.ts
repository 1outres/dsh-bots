import type { BotView } from "../shared/bots"
import type { BotRegistry } from "./registry"

/** Thrown when something tries to archive a bot's Main session. */
export class MainSessionArchiveError extends Error {
  constructor(bot: BotView) {
    super(
      `"${bot.name}" の Main セッションはアーカイブできません / The Main session of "${bot.name}" cannot be archived`,
    )
    this.name = "MainSessionArchiveError"
  }
}

/** What {language} reads as while the bot has no language. */
export const UNSET_LANGUAGE = "the language your owner writes in"

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" })

/** The English name of the bot's language (`ja` → Japanese), for a prompt. */
export function languageName(language: string | undefined): string {
  return language === undefined ? UNSET_LANGUAGE : (LANGUAGE_NAMES.of(language) ?? language)
}

/** Fill {name} and {language} in the greeting prompt. */
export function greetingText(template: string, bot: Pick<BotView, "name" | "language">): string {
  return template
    .replaceAll("{name}", bot.name)
    .replaceAll("{language}", languageName(bot.language))
}

export interface EnvironmentWaitDeps {
  /**
   * One check that the session's environment answers (its fs resolves and
   * stats the workspace); rejects when it does not. Undefined: nothing to
   * check with, ready at once.
   */
  probe: ((signal: AbortSignal) => Promise<void>) | undefined
  /** Resolves after `ms`, or early once `stopped()`. */
  sleep(ms: number): Promise<void>
  now(): number
  /** The plugin is unloading: give up quietly. */
  stopped(): boolean
  warn(message: string): void
  /** How long to wait for the environment in all. */
  budgetMs: number
  /** Pause between failed checks. */
  intervalMs: number
  /** Deadline of one check. */
  probeTimeoutMs: number
}

/**
 * Wait until a new session's environment answers.
 *
 * A turn's preparation (the system prompt reads the bot's workspace) fails the
 * whole turn when the environment cannot answer, and its message is consumed
 * with it. Right after a bot's VM is created its first SSH connection may
 * still be slow, so a new session waits until a check through the session's
 * own file system succeeds (which also leaves that connection open for the
 * turn), at most `budgetMs`; then it goes on with a warning, and a failure
 * shows in the session as any turn's would.
 *
 * @returns whether the session may go on (false only when unloading).
 */
export async function waitForEnvironment(
  deps: EnvironmentWaitDeps,
  label: string,
): Promise<boolean> {
  const deadline = deps.now() + deps.budgetMs
  let last: unknown
  if (deps.probe !== undefined) {
    for (;;) {
      if (deps.stopped()) return false
      try {
        await deps.probe(AbortSignal.timeout(deps.probeTimeoutMs))
        last = undefined
        break
      } catch (error) {
        last = error
      }
      if (deps.now() + deps.intervalMs >= deadline) break
      await deps.sleep(deps.intervalMs)
    }
  }
  if (deps.stopped()) return false
  if (last !== undefined) {
    deps.warn(
      `bot-core: the environment of ${label} did not answer within ${Math.round(deps.budgetMs / 1000)} s (${last instanceof Error ? last.message : String(last)}); going on anyway`,
    )
  }
  return true
}

export interface MainGuardDeps {
  registry: Pick<BotRegistry, "botOfMain">
  unarchive(sessionId: string): Promise<void>
  warn(message: string): void
  /** Run work after the current write queue turn. */
  later(work: () => void): void
}

/**
 * Keep Main sessions out of the archive.
 *
 * - `activity` answers the `workspace/session-activity` waterfall: a plain
 *   archive of a Main is refused with an error before anything is written.
 * - `archived` answers `workspace/session-archived`, which also fires for a
 *   stop-and-archive that skips the waterfall: the Main is unarchived again.
 */
export function createMainGuard(deps: MainGuardDeps) {
  return {
    async activity<T>(request: { sessionId: string }, next: () => Promise<T>): Promise<T> {
      const bot = deps.registry.botOfMain(request.sessionId)
      if (bot !== undefined) throw new MainSessionArchiveError(bot)
      return next()
    },
    archived(request: { sessionId: string }): void {
      const bot = deps.registry.botOfMain(request.sessionId)
      if (bot === undefined) return
      deps.later(() => {
        deps.unarchive(request.sessionId).catch((error: unknown) => {
          deps.warn(
            `bot-core: could not restore the Main session of "${bot.name}": ${String(error)}`,
          )
        })
      })
    },
  }
}
