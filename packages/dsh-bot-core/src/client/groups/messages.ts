import type { BotPeerMessagePage, BotPeerMessageView } from "../../shared/peers"
import { createStore, type Observable } from "../observable"

export type MessagesState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready"
      readonly messages: readonly BotPeerMessageView[]
      readonly earlier?: string
      readonly pages: number
      readonly reading: "idle" | "earlier" | "refresh"
      readonly failure?: string
    }
  | { readonly status: "failed"; readonly message: string }

export type ReadPage = (before: string | undefined) => Promise<BotPeerMessagePage>

export interface GroupMessages extends Observable<MessagesState> {
  refresh(): void
  loadEarlier(): void
  cancel(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface LoadedPages {
  readonly messages: readonly BotPeerMessageView[]
  readonly earlier?: string
  readonly pages: number
}

export async function readPages(read: ReadPage, count: number): Promise<LoadedPages> {
  const pages: BotPeerMessagePage[] = []
  let before: string | undefined
  do {
    const page = await read(before)
    pages.push(page)
    before = page.earlier
  } while (before !== undefined && pages.length < count)
  return {
    messages: pages.reverse().flatMap((page) => page.messages),
    ...(before === undefined ? {} : { earlier: before }),
    pages: pages.length,
  }
}

export function appendEarlier(loaded: LoadedPages, page: BotPeerMessagePage): LoadedPages {
  const known = new Set(loaded.messages.map((message) => message.id))
  return {
    messages: [...page.messages.filter((message) => !known.has(message.id)), ...loaded.messages],
    ...(page.earlier === undefined ? {} : { earlier: page.earlier }),
    pages: loaded.pages + 1,
  }
}

export function createGroupMessages(read: ReadPage): GroupMessages {
  const state = createStore<MessagesState>({ status: "loading" })
  let sequence = 0
  const settle = (loaded: LoadedPages) => state.set({ status: "ready", ...loaded, reading: "idle" })
  const fail = (message: string) => {
    const current = state.getSnapshot()
    state.set(
      current.status === "ready"
        ? { ...current, reading: "idle", failure: message }
        : { status: "failed", message },
    )
  }
  const run = (work: () => Promise<LoadedPages>) => {
    const ticket = ++sequence
    void work().then(
      (loaded) => {
        if (ticket === sequence) settle(loaded)
      },
      (error: unknown) => {
        if (ticket === sequence) fail(messageOf(error))
      },
    )
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    refresh() {
      const current = state.getSnapshot()
      if (current.status === "ready") {
        state.set({ ...current, reading: "refresh" })
        run(() => readPages(read, current.pages))
        return
      }
      state.set({ status: "loading" })
      run(() => readPages(read, 1))
    },
    loadEarlier() {
      const current = state.getSnapshot()
      if (current.status !== "ready" || current.earlier === undefined || current.reading !== "idle")
        return
      const { earlier } = current
      state.set({ ...current, reading: "earlier" })
      run(async () => appendEarlier(current, await read(earlier)))
    },
    cancel() {
      sequence += 1
      const current = state.getSnapshot()
      if (current.status === "ready" && current.reading !== "idle") {
        state.set({ ...current, reading: "idle" })
      }
    },
  }
}
