import type { BotTable } from "../registry"
import type { NoticeRecord, NoticeTopic } from "./domain"

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

export interface NoticeOutbox {
  enqueue(
    botId: string,
    topic: NoticeTopic,
    notice: { readonly text: string; readonly summary: string },
  ): Promise<NoticeEntry>
  pending(botId: string): readonly NoticeEntry[]
  bots(): readonly string[]
  byMessage(messageId: string): NoticeEntry | undefined
  delivered(noticeId: string): Promise<void>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
}

export function createNoticeOutbox(deps: NoticeOutboxDeps): NoticeOutbox {
  const memory = new Map<string, NoticeEntry>()
  for (const [id, record] of deps.notices.entries()) memory.set(id, { ...record, id })
  const listeners = new Set<(botId: string) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const ordered = (entries: Iterable<NoticeEntry>) =>
    [...entries].sort((a, b) => a.createdAt - b.createdAt)

  return {
    async enqueue(botId, topic, given) {
      const notice = await deps.shield(botId, given)
      const id = deps.newId()
      const record: NoticeRecord = {
        botId,
        topic,
        messageId: deps.newId(),
        text: notice.text,
        summary: notice.summary,
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
    byMessage: (messageId) => [...memory.values()].find((entry) => entry.messageId === messageId),
    async delivered(noticeId) {
      if (!memory.delete(noticeId)) return
      await serial(() => deps.notices.delete(noticeId))
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
  }
}
