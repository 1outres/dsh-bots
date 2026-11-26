import type { Observable } from "../observable"
import type { ConnectionFace } from "./connection"
import type { LayoutFace } from "./layout"
import type { RemoteService } from "./remote"
import type { UiSessionFace } from "./session"
import type { SlotsService } from "./slots"

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
  readonly projectionValues?: { readonly agentPreset?: string | null }
}

export interface SessionListState {
  readonly phase: "pending" | "ready"
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionSummary | undefined>>
}

export interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
  readonly title?: string
  readonly createdAt?: string
}

export interface WorkspaceSnapshot {
  readonly phase: "pending" | "ready"
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly string[]
}

export interface SessionActivityItem {
  readonly id: string
  readonly label?: string
}

export interface SessionActivity {
  readonly kind: string
  readonly items?: readonly SessionActivityItem[]
}

export interface UiWorkspaceFace {
  openSession(sessionId: string): void
  startSession(workspaceId?: string, options?: object): void
  archiveSession(sessionId: string, options?: { readonly stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
}

export type LocalizedText =
  | string
  | { readonly en: string; readonly [locale: string]: string | undefined }

export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface MenuTarget {
  readonly kind: string
  readonly value: unknown
}

export interface MenuAction {
  readonly id: string
  readonly label: string
  readonly icon?: { readonly key: string }
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly separatorBefore?: boolean
  readonly failureLabel?: string
  readonly run?: () => void | Promise<void>
  readonly children?: readonly MenuAction[]
}

export interface ContextMenus {
  readonly active: Observable<MenuTarget | null>
  register(contribution: {
    readonly id: string
    readonly target: string
    readonly order: number
    // biome-ignore lint/suspicious/noExplicitAny: -
    observe?(target: any): readonly Observable<unknown>[]
    // biome-ignore lint/suspicious/noExplicitAny: -
    resolve(target: any, signal: AbortSignal): readonly MenuAction[]
  }): () => void
  open(target: MenuTarget, point: { x: number; y: number }, options?: { button: string }): void
  close(): void
}

export interface ClientContext {
  effect(effect: () => (() => void) | undefined, label?: string): void
  get(name: string): unknown
  slots: SlotsService
  inject(
    deps: readonly string[],
    callback: (ctx: ClientContext & { readonly [service: string]: unknown }) => void,
  ): void
  locale: {
    register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
    bind(namespace: string): Translate
    resolveText(text: LocalizedText): string
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
  uiSession: UiSessionFace
  uiWorkspace: UiWorkspaceFace
  layout: LayoutFace
}
