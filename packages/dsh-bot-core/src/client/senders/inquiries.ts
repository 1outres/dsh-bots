import type {
  BotSenderInquiriesSnapshot,
  SenderAnswerResult,
  SenderChoice,
  SenderInquiryView,
  SenderWaitingSnapshot,
} from "../../shared/senders"
import { followStream } from "../approvals/follow"
import { createFeedHub } from "../feed-hub"
import { createStore, type Observable } from "../observable"
import type { BotSendersRemote, RemoteMount } from "../remote"

export type InquiriesState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready"
      readonly inquiries: readonly SenderInquiryView[]
      readonly reconnecting: boolean
    }
  | { readonly status: "failed"; readonly message: string }

export type AnswerOutcome =
  | { readonly kind: "result"; readonly result: SenderAnswerResult }
  | { readonly kind: "unreachable"; readonly message: string }

export interface InquiriesModel extends Observable<InquiriesState> {
  answer(inquiryId: string, choice: SenderChoice): Promise<AnswerOutcome>
  dispose(): void
}

export interface InquiriesDeps {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createInquiriesModel(deps: InquiriesDeps, botId: string): InquiriesModel {
  const state = createStore<InquiriesState>({ status: "loading" })
  let disposed = false
  let stop: (() => void) | undefined
  let face: BotSendersRemote | undefined
  void deps.mount.then((mounted) => {
    if (disposed) return
    if (mounted.status === "failed") {
      state.set({ status: "failed", message: mounted.error })
      return
    }
    const remote = mounted.remote.botSenders
    face = remote
    stop = followStream({
      generation: deps.generation,
      open: () => remote.watchBot(botId),
      item: (snapshot: BotSenderInquiriesSnapshot) =>
        state.set({ status: "ready", inquiries: snapshot.inquiries, reconnecting: false }),
      lost(message) {
        const current = state.getSnapshot()
        if (current.status === "ready") state.set({ ...current, reconnecting: true })
        else if (message !== undefined) state.set({ status: "failed", message })
      },
    })
  })
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    async answer(inquiryId, choice) {
      if (face === undefined) return { kind: "unreachable", message: "not connected yet" }
      try {
        const result = await face.answer(inquiryId, choice)
        return result.ok
          ? { kind: "result", result: result.value }
          : { kind: "unreachable", message: result.error.message ?? "the answer was refused" }
      } catch (error) {
        return { kind: "unreachable", message: messageOf(error) }
      }
    },
    dispose() {
      disposed = true
      stop?.()
    },
  }
}

export interface InquiriesFeed extends Observable<InquiriesState>, Pick<InquiriesModel, "answer"> {}

export interface InquiriesHub {
  feed(botId: string): InquiriesFeed
}

export function createInquiriesHub(open: (botId: string) => InquiriesModel): InquiriesHub {
  return createFeedHub<InquiriesState, InquiriesModel, Pick<InquiriesFeed, "answer">>({
    name: "sender inquiries",
    idle: { status: "loading" },
    open,
    extend: (followed) => ({
      answer: async (inquiryId, choice) => followed().answer(inquiryId, choice),
    }),
  })
}

export interface SenderWaitingStore extends Observable<Readonly<Record<string, number>>> {
  dispose(): void
}

const NONE: Readonly<Record<string, number>> = {}

export function watchSenderWaiting(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
): SenderWaitingStore {
  const state = createStore<Readonly<Record<string, number>>>(NONE)
  let disposed = false
  let stop: (() => void) | undefined
  void mount.then((mounted) => {
    if (disposed || mounted.status === "failed") return
    const remote = mounted.remote.botSenders
    stop = followStream({
      generation,
      open: () => remote.watchWaiting(),
      item: (snapshot: SenderWaitingSnapshot) => state.set(snapshot.waiting),
      lost: () => {},
    })
  })
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
