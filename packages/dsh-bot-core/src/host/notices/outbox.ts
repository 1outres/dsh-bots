import type { BotTable } from "../registry"
import type { NoticeRecord, NoticeTopic } from "./domain"

export interface NoticeOutboxDeps {
  /** The notices table of NOTICES_DOMAIN; only the outbox writes it (design rule 41). */
  notices: BotTable<NoticeRecord>
  /**
   * The notice with the bot's secrets withheld (docs/specs/bot-vaults.md §7.2).
   * @throws when the vault guard cannot check it: nothing is stored.
   */
  shield(
    botId: string,
    notice: { readonly text: string; readonly summary: string },
  ): Promise<{ readonly text: string; readonly summary: string }>
  newId(): string
  now(): number
}

/** A stored notice and its id. */
export interface NoticeEntry extends NoticeRecord {
  readonly id: string
}

/**
 * bot-core's durable outbox of notices to bots' Main sessions. A notice is
 * stored before anything tries to deliver it, and stays until its message is
 * recorded in the Main session, so a restart or a dropped inbox sends it again.
 */
export interface NoticeOutbox {
  /** Store a notice; listeners learn of it once stored. */
  enqueue(
    botId: string,
    topic: NoticeTopic,
    notice: { readonly text: string; readonly summary: string },
  ): Promise<NoticeEntry>
  /** The bot's notices, oldest first. */
  pending(botId: string): readonly NoticeEntry[]
  /** Bots with notices. */
  bots(): readonly string[]
  /** The notice its message carries, if still stored. */
  byMessage(messageId: string): NoticeEntry | undefined
  /** Its message is recorded in the Main session: the notice leaves the outbox. */
  delivered(noticeId: string): Promise<void>
  /** Drop the notices of bots `keep` refuses. */
  purge(keep: (botId: string) => boolean): Promise<void>
  /** Called with the bot after a notice of it was stored. */
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
