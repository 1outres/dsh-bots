// Source: dsh-client-ui-renderer, dsh-client-ui-layout, dsh-client-locale, dsh-client-connection, dsh-client-ui-context-menu, dsh-api-session-controller, dsh-api-workspace-controller, dsh-client-ui-workspace client services.
import type { Observable } from "../observable"
import type { ConnectionFace } from "./connection"
import type { LayoutFace } from "./layout"
import type { RemoteService } from "./remote"
import type { UiSessionFace } from "./session"
import type { SlotsService } from "./slots"

/** dsh-api-session-controller sessions/service.ts `SessionSummary`. */
export interface SessionSummary {
  readonly id: string
  readonly displayTitle: string
  readonly title?: string
  readonly cwd?: string
  readonly origin?: "subagent"
  readonly running: boolean
  readonly blank: boolean
  readonly updatedAt: number
  readonly retainedBy?: { readonly mainView?: number }
  /** dsh-agent-preset-registry session.ts: the session's agent preset, `null` for the default. */
  readonly projectionValues?: { readonly agentPreset?: string | null }
}

/** dsh-api-session-controller sessions/service.ts `SessionListState`. */
export interface SessionListState {
  readonly phase: "pending" | "ready"
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummary | undefined>>
}

/** dsh-api-workspace-controller `WorkspaceView`. */
export interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
  readonly title?: string
  /** ISO-8601 creation instant. */
  readonly createdAt?: string
}

/** dsh-api-workspace-controller `WorkspaceSnapshot`. */
export interface WorkspaceSnapshot {
  readonly phase: "pending" | "ready"
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly string[]
}

/** dsh-workspace `SessionActivityItem`. */
export interface SessionActivityItem {
  readonly id: string
  readonly label?: string
}

/** dsh-workspace `SessionActivity`: one reason the Host refuses to archive a running session. */
export interface SessionActivity {
  /** `turn`, `subagent`, `job`, `schedule`, or a family another provider merges. */
  readonly kind: string
  readonly items?: readonly SessionActivityItem[]
}

/** dsh-client-ui-workspace `UiWorkspace`, as far as bot-core uses it. */
export interface UiWorkspaceFace {
  openSession(sessionId: string): void
  startSession(workspaceId?: string, options?: object): void
  /**
   * Archive a session and clear the main view when it shows it. Without
   * `stopActivity`, a session with running work is refused as a
   * `WorkspaceArchiveError` whose `rpcError` is `workspace/session-active`.
   */
  archiveSession(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
}

/** dsh-package-manifest `LocalizedText`. */
export type LocalizedText =
  | string
  | { readonly en: string; readonly [locale: string]: string | undefined }

/** dsh-client-locale namespace-bound translate. */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/** dsh-client-ui-context-menu target. */
export interface MenuTarget {
  readonly kind: string
  readonly value: unknown
}

/** dsh-client-ui-context-menu action. */
export interface MenuAction {
  readonly id: string
  readonly label: string
  readonly icon?: { readonly key: string }
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly separatorBefore?: boolean
  readonly failureLabel?: string
  readonly run?: () => void | Promise<void>
  /** A submenu. */
  readonly children?: readonly MenuAction[]
}

/** `ctx.contextMenus` (dsh-client-ui-context-menu). */
export interface ContextMenus {
  readonly active: Observable<MenuTarget | null>
  register(contribution: {
    readonly id: string
    readonly target: string
    readonly order: number
    // biome-ignore lint/suspicious/noExplicitAny: the value type is the contributor's own target
    observe?(target: any): readonly Observable<unknown>[]
    // biome-ignore lint/suspicious/noExplicitAny: the value type is the contributor's own target
    resolve(target: any, signal: AbortSignal): readonly MenuAction[]
  }): () => void
  open(target: MenuTarget, point: { x: number; y: number }, options?: { button: string }): void
  close(): void
}

/** The client Cordis context, as far as bot-core uses it. */
export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  get(name: string): unknown
  slots: SlotsService
  /** Cordis `ctx.inject`: run `callback` with a child context while every named service is available. */
  inject(
    deps: readonly string[],
    callback: (ctx: ClientContext & { readonly [service: string]: unknown }) => void,
  ): void
  locale: {
    register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
    bind(namespace: string): Translate
    /** Package text in the active language, English when it has none. */
    resolveText(text: LocalizedText): string
    /** dsh-client-locale `LocaleRuntime.getSnapshot`: the active and the selectable languages. */
    getSnapshot(): {
      readonly active: string
      readonly locales: readonly { readonly id: string; readonly label: string }[]
    }
  }
  contextMenus: ContextMenus
  remote: RemoteService
  connection: ConnectionFace
  sessions: {
    readonly list: Observable<SessionListState>
    create(options: { workspaceId?: string; cwd?: string }): Promise<string>
  }
  workspaces: { readonly list: Observable<WorkspaceSnapshot> }
  /** dsh-client-ui-session: the scope adapter the Slot renderer binds sessions with. */
  uiSession: UiSessionFace
  uiWorkspace: UiWorkspaceFace
  /** dsh-client-ui-layout */
  layout: LayoutFace
}
