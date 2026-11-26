import type { BotTable } from "../registry"
import { type NoticeRecord, type NoticeTopic, PEER_ORIGIN_TOPICS } from "./domain"

export interface NoticeOutboxDeps {
  notices: BotTable<NoticeRecord>
  shield(
    botId: string,
    notice: { readonly text: string; readonly summary: string },
  ): Promise<{ readonly text: string; readonly summary: string }>
  newId(): string
  now(): number
}

export interface NoticeEntry extends NoticeRecord {
  readonly id: string
}

export interface NoticeContent {
  readonly text: string
  readonly summary: string
}

export interface NoticeOrigin {
  readonly peerMessages: readonly string[]
}

export interface NoticeOutbox {
  enqueue(
    botId: string,
    topic: NoticeTopic,
    notice: NoticeContent,
    origin?: NoticeOrigin,
  ): Promise<NoticeEntry>
  pending(botId: string): readonly NoticeEntry[]
  bots(): readonly string[]
  entry(noticeId: string): NoticeEntry | undefined
  byMessage(messageId: string): NoticeEntry | undefined
  delivered(noticeId: string): Promise<void>
  withdraw(noticeId: string): Promise<boolean>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
  onDelivered(listener: (entry: NoticeEntry) => void): () => void
}

function originProblem(topic: NoticeTopic, origin: NoticeOrigin | undefined): string | undefined {
  if (origin !== undefined && !PEER_ORIGIN_TOPICS.includes(topic)) {
    return `a "${topic}" notice carries no peer messages`
  }
  if (topic === "peer" && origin?.peerMessages.length !== 1) {
    return 'a "peer" notice carries exactly the peer message it delivers'
  }
  return undefined
}

export function createNoticeOutbox(deps: NoticeOutboxDeps): NoticeOutbox {
  const memory = new Map<string, NoticeEntry>()
  for (const [id, record] of deps.notices.entries()) memory.set(id, { ...record, id })
  const listeners = new Set<(botId: string) => void>()
  const deliveredListeners = new Set<(entry: NoticeEntry) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const ordered = (entries: Iterable<NoticeEntry>) =>
    [...entries].sort((a, b) => a.createdAt - b.createdAt)
  const take = (noticeId: string): NoticeEntry | undefined => {
    const entry = memory.get(noticeId)
    if (entry !== undefined) memory.delete(noticeId)
    return entry
  }

  return {
    async enqueue(botId, topic, given, origin) {
      const problem = originProblem(topic, origin)
      if (problem !== undefined) throw new Error(`bot-core: ${problem}`)
      const notice = await deps.shield(botId, given)
      const id = deps.newId()
      const record: NoticeRecord = {
        botId,
        topic,
        messageId: deps.newId(),
        text: notice.text,
        summary: notice.summary,
        ...(origin === undefined ? {} : { peerMessages: [...origin.peerMessages] }),
        createdAt: deps.now(),
      }
      await serial(() => deps.notices.put(id, record))
      const entry = { ...record, id }
      memory.set(id, entry)
      for (const listener of [...listeners]) listener(botId)
      return entry
    },
    pending: (botId) => ordered([...memory.values()].filter((entry) => entry.botId === botId)),
    bots: () => [...new Set([...memory.values()].map((entry) => entry.botId))],
    entry: (noticeId) => memory.get(noticeId),
    byMessage: (messageId) => [...memory.values()].find((entry) => entry.messageId === messageId),
    async delivered(noticeId) {
      const entry = take(noticeId)
      if (entry === undefined) return
      await serial(() => deps.notices.delete(noticeId))
      for (const listener of [...deliveredListeners]) listener(entry)
    },
    async withdraw(noticeId) {
      if (take(noticeId) === undefined) return false
      await serial(() => deps.notices.delete(noticeId))
      return true
    },
    async purge(keep) {
      const gone = [...memory.values()].filter((entry) => !keep(entry.botId))
      for (const entry of gone) memory.delete(entry.id)
      await serial(async () => {
        for (const entry of gone) await deps.notices.delete(entry.id)
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    onDelivered(listener) {
      deliveredListeners.add(listener)
      return () => {
        deliveredListeners.delete(listener)
      }
    },
  }
}
