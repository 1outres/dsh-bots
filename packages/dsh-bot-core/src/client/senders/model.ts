import type {
  BotSendersSnapshot,
  SenderAnswerResult,
  SenderChoice,
  SenderMatch,
  SenderPolicyView,
  SenderRecipientsView,
  SenderRuleChange,
  SenderUnknown,
} from "../../shared/senders"
import { createFeedHub } from "../feed-hub"
import { createStore, type Observable } from "../observable"
import type { BotSendersRemote, RemoteMount } from "../remote"
import type { RemoteResult, StreamHandle } from "../types"

export class SendersError extends Error {
  override readonly name = "SendersError"
}

export type SendersState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotSendersSnapshot }
  | { readonly status: "failed"; readonly message: string }

export interface SendersOperations {
  setUnknown(connectionId: string, unknown: SenderUnknown): Promise<SenderPolicyView>
  putRules(connectionId: string, rules: readonly SenderRuleChange[]): Promise<SenderPolicyView>
  removeRule(connectionId: string, match: SenderMatch): Promise<SenderPolicyView>
  copy(fromConnectionId: string, toConnectionId: string): Promise<SenderPolicyView>
  recipients(connectorId: string, connectionId: string): Promise<SenderRecipientsView>
  answer(inquiryId: string, choice: SenderChoice): Promise<SenderAnswerResult>
}

export interface SendersModel extends Observable<SendersState>, SendersOperations {
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function sendersOf(mount: Promise<RemoteMount>): Promise<BotSendersRemote> {
  const mounted = await mount
  if (mounted.status === "failed") throw new SendersError(mounted.error)
  return mounted.remote.botSenders
}

export function createSendersModel(mount: Promise<RemoteMount>): SendersModel {
  const state = createStore<SendersState>({ status: "loading" })
  let disposed = false
  let handle: StreamHandle<BotSendersSnapshot> | undefined
  void (async () => {
    try {
      const senders = await sendersOf(mount)
      if (disposed) return
      handle = senders.watch()
      for await (const snapshot of handle) {
        if (disposed) return
        state.set({ status: "ready", snapshot })
      }
    } catch (error) {
      if (!disposed) state.set({ status: "failed", message: messageOf(error) })
    }
  })()
  const call = async <T>(
    run: (senders: BotSendersRemote) => Promise<RemoteResult<T>>,
  ): Promise<T> => {
    const senders = await sendersOf(mount)
    let result: RemoteResult<T>
    try {
      result = await run(senders)
    } catch (error) {
      throw new SendersError(messageOf(error))
    }
    if (result.ok) return result.value
    throw new SendersError(result.error.message ?? "the request was refused")
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    setUnknown: (connectionId, unknown) =>
      call((remote) => remote.setUnknown(connectionId, unknown)),
    putRules: (connectionId, rules) => call((remote) => remote.putRules(connectionId, rules)),
    removeRule: (connectionId, match) => call((remote) => remote.removeRule(connectionId, match)),
    copy: (from, to) => call((remote) => remote.copy(from, to)),
    recipients: (connectorId, connectionId) =>
      call((remote) => remote.recipients(connectorId, connectionId)),
    answer: (inquiryId, choice) => call((remote) => remote.answer(inquiryId, choice)),
    dispose() {
      disposed = true
      handle?.dispose()
    },
  }
}

export type SendersFeed = Observable<SendersState> & SendersOperations

export function createSendersFeed(open: () => SendersModel): SendersFeed {
  const hub = createFeedHub<SendersState, SendersModel, SendersOperations>({
    name: "sender policies",
    idle: { status: "loading" },
    open,
    extend: (followed) => ({
      setUnknown: async (connectionId, unknown) => followed().setUnknown(connectionId, unknown),
      putRules: async (connectionId, rules) => followed().putRules(connectionId, rules),
      removeRule: async (connectionId, match) => followed().removeRule(connectionId, match),
      copy: async (from, to) => followed().copy(from, to),
      recipients: async (connectorId, connectionId) =>
        followed().recipients(connectorId, connectionId),
      answer: async (inquiryId, choice) => followed().answer(inquiryId, choice),
    }),
  })
  return hub.feed("all")
}
