import type { BotView } from "../shared/bots"
import type { BotRegistry } from "./registry"

export class MainSessionArchiveError extends Error {
  constructor(bot: BotView) {
    super(
      `"${bot.name}" の Main セッションはアーカイブできません / The Main session of "${bot.name}" cannot be archived`,
    )
    this.name = "MainSessionArchiveError"
  }
}

export const UNSET_LANGUAGE = "the language your owner writes in"

const LANGUAGE_NAMES = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" })

export function languageName(language: string | undefined): string {
  return language === undefined ? UNSET_LANGUAGE : (LANGUAGE_NAMES.of(language) ?? language)
}

export function greetingText(template: string, bot: Pick<BotView, "name" | "language">): string {
  return template
    .replaceAll("{name}", bot.name)
    .replaceAll("{language}", languageName(bot.language))
}

export interface EnvironmentWaitDeps {
  probe: ((signal: AbortSignal) => Promise<void>) | undefined
  sleep(ms: number): Promise<void>
  now(): number
  stopped(): boolean
  warn(message: string): void
  budgetMs: number
  intervalMs: number
  probeTimeoutMs: number
}

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
  later(work: () => void): void
}

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
