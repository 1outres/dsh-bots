/**
 * Working directories of bot Agents, validated in the bot's environment.
 *
 * A bot session's directory (the environment's workspace, e.g.
 * `/home/bot/workspace`) exists only inside the bot's environment. DSH's Host
 * `workingDirectory` service validates every Agent's directory with the
 * Host's file system (when it assembles the system prompt, for subagents, the
 * terminal, @-mentions…), so it would fail every bot turn. Both of its
 * operations, `ensure` (path null) and `set`, run through the
 * `working-directory/access` waterfall; for a bot Agent this listener answers
 * without calling `next()`, so the Host's file system is never touched:
 *
 * - `ensure`: the current directory, checked with the environment's file
 *   system. Missing (a session from before bots ran in their environment's
 *   workspace, still in a Host path): switched to the environment's workspace
 *   once, with the same notice DSH gives. The check failing for another reason
 *   (the environment is unreachable) keeps the current directory: the bot's
 *   tools fail on their own, the turn goes on.
 * - `set`: resolved against the current directory and checked in the
 *   environment, then committed like DSH does (a `working-directory/change`
 *   event and a notice).
 *
 * The environment's file system is the one inside the Agent's composition
 * (`agentPresets.serviceFor(agent, "fs")`) when that is the bot's own preset,
 * or its parent's for a subagent that is not composed yet (DSH sets a new
 * subagent's directory before it joins its parent's preset). An Agent of the
 * bot's session on another preset gets none: `ensure` returns its recorded
 * directory without I/O and `set` is refused. Every Agent that is not a bot session's passes
 * straight to `next()`. An unverified session (see identity.ts: a subagent
 * naming a bot's preset whose parent is not running) is never checked, on
 * the Host or in an environment: `ensure` returns its recorded directory
 * without I/O and `set` is refused (it is locked down anyway).
 *
 * Nothing here touches DSH directly: every Host interaction is injected.
 */
import type { SessionIdentity } from "./preset/identity"

/** What the environment's file system offers here (a dsh-fs `Fs`, structurally). */
export interface EnvironmentFs {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  stat(target: never, signal?: AbortSignal): Promise<{ readonly type: string } | undefined>
  processPath(target: never): string
}

/** The `working-directory/access` request (dsh-working-directory). */
export interface AccessRequest<A> {
  readonly agent: A
  /** null validates the current directory (`ensure`), a path changes it (`set`). */
  readonly path: string | null
  readonly signal: AbortSignal
}

export interface WorkingDirectoryDeps<A> {
  /** Whose session the Agent runs (identity.ts). */
  sessionOf(agent: A): SessionIdentity
  /**
   * The environment's file system of bot `botId` for its Agent, or undefined
   * when the Agent is not composed on the bot's preset (nor, uncomposed, is
   * its parent).
   */
  fsOf(agent: A, botId: string): EnvironmentFs | undefined
  /** The Agent's recorded directory, without I/O (`workingDirectory.get(session)`). */
  current(agent: A): string
  /** The directory the session was created in (`header.cwd`). */
  original(agent: A): string | undefined
  /** The registered environment's workspace, or undefined without one. */
  workspace(): string | undefined
  /**
   * Record the new directory as DSH would: check `signal` and the Agent's
   * scope, append `working-directory/change` and queue `notice` for the model.
   */
  commit(agent: A, directory: string, notice: string, signal: AbortSignal): void
}

/** An error carrying a dsh-working-directory error code. */
export class BotWorkingDirectoryError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = "BotWorkingDirectoryError"
    this.code = code
  }
}

const quote = (value: string) => JSON.stringify(value)

export function createWorkingDirectoryAccess<A>(deps: WorkingDirectoryDeps<A>) {
  const unverified = (agent: A, path: string | null, reason: string): Promise<string> =>
    path === null
      ? Promise.resolve(deps.current(agent))
      : Promise.reject(
          new BotWorkingDirectoryError(
            `working-directory: the directory of this Agent cannot change: ${reason}`,
            "WORKING_DIRECTORY_UNAVAILABLE",
          ),
        )

  /** The canonical directory `path` names in the environment, or undefined when it is none. */
  const directory = async (
    fs: EnvironmentFs,
    path: string,
    cwd: string,
    signal: AbortSignal,
  ): Promise<string | undefined> => {
    const target = (await fs.resolve(path, { cwd, signal })) as never
    const info = await fs.stat(target, signal)
    signal.throwIfAborted()
    return info?.type === "directory" ? fs.processPath(target) : undefined
  }

  const ensure = async (agent: A, botId: string, signal: AbortSignal): Promise<string> => {
    const current = deps.current(agent)
    const fs = deps.fsOf(agent, botId)
    // Not composed on the bot's preset (a locked-down Agent): nothing to
    // check it with, and never with the Host's file system.
    if (fs === undefined) return current
    let found: string | undefined
    try {
      found = await directory(fs, current, current, signal)
    } catch {
      signal.throwIfAborted()
      // The environment cannot answer now; its tools will say so.
      return current
    }
    if (found !== undefined) return current
    const fallback = deps.workspace() ?? deps.original(agent)
    const restored =
      fallback === undefined || fallback === current
        ? undefined
        : await directory(fs, fallback, fallback, signal)
    if (restored === undefined) {
      throw new BotWorkingDirectoryError(
        `working-directory: the directory ${quote(current)} of bot "${botId}" does not exist in its environment${
          fallback === undefined || fallback === current ? "" : `, nor does ${quote(fallback)}`
        }`,
        "WORKING_DIRECTORY_UNAVAILABLE",
      )
    }
    deps.commit(
      agent,
      restored,
      `The working directory ${quote(current)} is unavailable. The working directory is now ${quote(restored)}.`,
      signal,
    )
    return restored
  }

  const set = async (agent: A, botId: string, path: string, signal: AbortSignal) => {
    if (path.length === 0) {
      throw new BotWorkingDirectoryError(
        "working-directory: cd must not be empty",
        "WORKING_DIRECTORY_INVALID",
      )
    }
    const fs = deps.fsOf(agent, botId)
    if (fs === undefined) {
      throw new BotWorkingDirectoryError(
        `working-directory: this Agent does not run bot "${botId}"'s preset in its environment, so its directory cannot change`,
        "WORKING_DIRECTORY_UNAVAILABLE",
      )
    }
    const current = deps.current(agent)
    const found = await directory(fs, path, current, signal)
    if (found === undefined) {
      throw new BotWorkingDirectoryError(
        `working-directory: directory does not exist: ${quote(path)}`,
        "WORKING_DIRECTORY_NOT_FOUND",
      )
    }
    if (found !== current) {
      deps.commit(
        agent,
        found,
        `The working directory changed from ${quote(current)} to ${quote(found)}.`,
        signal,
      )
    }
    return found
  }

  /** The `working-directory/access` listener: `next()` at once for every Agent but a bot's. */
  return (request: AccessRequest<A>, next: () => Promise<string>): Promise<string> => {
    const session = deps.sessionOf(request.agent)
    if (session.kind === "none") return next()
    if (session.kind === "unverified") {
      return unverified(request.agent, request.path, session.reason)
    }
    return request.path === null
      ? ensure(request.agent, session.botId, request.signal)
      : set(request.agent, session.botId, request.path, request.signal)
  }
}
