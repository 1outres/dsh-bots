import { createStore, type Observable } from "./observable"

/** A passing word about a bot's creation or removal, or about one of its sessions. */
export type BotNotice =
  | { readonly kind: "created"; readonly name: string }
  | { readonly kind: "create-failed"; readonly name: string }
  | { readonly kind: "remove-failed"; readonly name: string }
  | { readonly kind: "session-archived"; readonly botId: string; readonly sessionId: string }
  | { readonly kind: "archived-not-openable" }
  | { readonly kind: "main-started"; readonly name: string }
  | { readonly kind: "main-unchanged"; readonly name: string }

export type NoticeTone = "success" | "info" | "warning" | "error"

/** How long a notice stays unless replaced; it fades out over its last {@link NOTICE_FADE_MS}. */
export const NOTICE_MS = 6000
export const NOTICE_FADE_MS = 1000

const TONES: { readonly [Kind in BotNotice["kind"]]: NoticeTone } = {
  created: "success",
  "create-failed": "error",
  "remove-failed": "error",
  "session-archived": "info",
  "archived-not-openable": "warning",
  "main-started": "success",
  "main-unchanged": "info",
}

export const noticeTone = (notice: BotNotice): NoticeTone => TONES[notice.kind]

export interface ShownNotice {
  readonly notice: BotNotice
  /** Tells one showing from the next, also of the same notice. */
  readonly seq: number
}

export interface NoticeStore extends Observable<ShownNotice | null> {
  /** Show a notice in place of the one shown. */
  show(notice: BotNotice): void
  /** Take down the showing `seq`; a later one stays. */
  dismiss(seq: number): void
}

export function createNoticeStore(): NoticeStore {
  const state = createStore<ShownNotice | null>(null)
  let seq = 0
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    show(notice) {
      seq += 1
      state.set({ notice, seq })
    },
    dismiss(shown) {
      if (state.getSnapshot()?.seq === shown) state.set(null)
    },
  }
}
