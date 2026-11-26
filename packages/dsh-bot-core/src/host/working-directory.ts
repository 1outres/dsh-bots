import type { SessionIdentity } from "./preset/identity"

export interface EnvironmentFs {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  stat(target: never, signal?: AbortSignal): Promise<{ readonly type: string } | undefined>
  processPath(target: never): string
}

export interface AccessRequest<A> {
  readonly agent: A
  readonly path: string | null
  readonly signal: AbortSignal
}

export interface WorkingDirectoryDeps<A> {
  sessionOf(agent: A): SessionIdentity
  fsOf(agent: A, botId: string): EnvironmentFs | undefined
  current(agent: A): string
  original(agent: A): string | undefined
  workspace(): string | undefined
  commit(agent: A, directory: string, notice: string, signal: AbortSignal): void
}

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
    if (fs === undefined) return current
    let found: string | undefined
    try {
      found = await directory(fs, current, current, signal)
    } catch {
      signal.throwIfAborted()
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
