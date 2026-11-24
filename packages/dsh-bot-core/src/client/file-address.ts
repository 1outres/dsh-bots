export type FileAddress =
  | { readonly scope: "session"; readonly sessionId: string; readonly path: string }
  | { readonly scope: "absolute"; readonly path: string }

const FILE_ADDRESS_PREFIX = "dsh-resource://file/"

/** The glob a tab type claims every session-scoped file address with. */
export const SESSION_FILE_PATTERN = "dsh-resource://file/session/**"

function isDriveSegment(segment: string | undefined): boolean {
  return segment !== undefined && /^[A-Za-z]:$/.test(segment)
}

/** Copy of dsh-util-workspace-path `parseFileAddress` (pinned in upstream.ts; design rule 30 forbids importing it). */
export function parseFileAddress(address: string): FileAddress | undefined {
  try {
    if (!address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
    const end = address.search(/[?#]/)
    const [scope, ...rest] = address
      .slice(FILE_ADDRESS_PREFIX.length, end === -1 ? undefined : end)
      .split("/")
    if (scope === "session") {
      const [id, ...segments] = rest
      if (id === undefined || id === "" || segments.length === 0) return undefined
      return {
        scope,
        sessionId: decodeURIComponent(id),
        path: segments.map(decodeURIComponent).join("/"),
      }
    }
    if (scope === "absolute") {
      const unc = rest[0] === "" && rest.length > 1
      const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
      if (segments.length === 0 || segments[0] === "") return undefined
      if (unc) return { scope, path: `//${segments.join("/")}` }
      return {
        scope,
        path: isDriveSegment(segments[0]) ? segments.join("/") : `/${segments.join("/")}`,
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/** A file of a bot session: what the bot viewer opens. */
export interface BotFileTarget {
  readonly sessionId: string
  /** Workspace-relative or absolute path in the bot's environment; never empty. */
  readonly path: string
}

/** The bot file a session-scoped address names; an `absolute` address carries no session, so it is never a bot's. */
export function botFileTarget(
  address: string,
  isBotSession: (sessionId: string) => boolean,
): BotFileTarget | undefined {
  const parsed = parseFileAddress(address)
  if (parsed?.scope !== "session" || parsed.path === "") return undefined
  return isBotSession(parsed.sessionId)
    ? { sessionId: parsed.sessionId, path: parsed.path }
    : undefined
}

/** The last segment of a path, for titles. */
export function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1)
  return name === "" ? path : name
}
