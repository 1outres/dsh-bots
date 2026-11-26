import type { NoticeEntry } from "../notices/outbox"
import type { PeerMessageRecord } from "./domain"
import type { PeerGroups, PeerWithdrawn } from "./groups"
import { PEER_LIMITS } from "./limits"
import { type UndeliveredItem, undeliveredNotice } from "./notice"
import type { PeerNotices } from "./send"
import type { PeerStore } from "./store"

export interface PeerDeliveryDeps {
  groups: Pick<PeerGroups, "state" | "onWithdrawn">
  store: Pick<PeerStore, "change">
  notices: PeerNotices
  exists(botId: string): boolean
  botName(botId: string): string | undefined
  stopped(botId: string): boolean
  later(ms: number, work: () => void): () => void
  now(): number
  warn(message: string): void
}

export interface PeerDelivery {
  start(): void
  track(messageId: string): void
  delivered(entry: Pick<NoticeEntry, "topic" | "peerMessages">): void
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createPeerDelivery(deps: PeerDeliveryDeps): PeerDelivery {
  const timers = new Map<string, () => void>()
  let disposed = false

  const nameOf = (botId: string) => deps.botName(botId) ?? `bot ${botId}`

  const tellUndelivered = (items: readonly (UndeliveredItem & { readonly from: string })[]) => {
    const bySender = new Map<string, UndeliveredItem[]>()
    for (const { from, ...item } of items) {
      bySender.set(from, [...(bySender.get(from) ?? []), item])
    }
    for (const [from, list] of bySender) {
      deps.notices.enqueue(from, "peer-status", undeliveredNotice(list)).catch((error: unknown) => {
        deps.warn(
          `bot-core: could not tell bot "${from}" about undelivered peer messages: ${messageOf(error)}`,
        )
      })
    }
  }

  const settle = (messageId: string, next: (current: PeerMessageRecord) => PeerMessageRecord) =>
    deps.store.change((state) => {
      const current = state.messages.get(messageId)
      if (current === undefined) return { writes: [], result: undefined }
      const record = next(current)
      return record === current
        ? { writes: [], result: record }
        : { writes: [{ kind: "put-message", messageId, record }], result: record }
    })

  const markDelivered = (messageId: string) =>
    settle(messageId, (current) => {
      if (current.state !== "queued" && current.state !== "withdrawn") return current
      const { withdrawal: _withdrawal, ...rest } = current
      return { ...rest, state: "delivered" }
    })

  const notifiable = (withdrawn: PeerWithdrawn) => {
    const { message } = withdrawn
    if (!deps.exists(message.from)) return false
    if (message.withdrawal !== "left-group") return true
    return deps.groups.state().members.get(message.from)?.groupId === message.groupId
  }

  const withdrawAll = async (list: readonly PeerWithdrawn[]) => {
    const told: (UndeliveredItem & { readonly from: string })[] = []
    for (const withdrawn of list) {
      const { messageId, message } = withdrawn
      timers.get(messageId)?.()
      timers.delete(messageId)
      if (message.noticeId !== undefined) {
        try {
          if ((await deps.notices.withdraw(message.noticeId)) === "recorded") {
            await markDelivered(messageId)
            continue
          }
        } catch (error) {
          deps.warn(`bot-core: could not withdraw peer message "${messageId}": ${messageOf(error)}`)
        }
      }
      if (!notifiable(withdrawn) || message.withdrawal === undefined) continue
      told.push({
        from: message.from,
        messageId,
        toName: nameOf(message.to),
        groupName: withdrawn.groupName,
        withdrawal: message.withdrawal,
        stopped: false,
      })
    }
    if (told.length > 0) tellUndelivered(told)
  }

  const expire = async (messageId: string) => {
    timers.delete(messageId)
    const current = deps.groups.state().messages.get(messageId)
    if (current?.state !== "queued") return
    if (current.noticeId !== undefined) {
      const outcome = await deps.notices.withdraw(current.noticeId)
      if (outcome === "recorded") {
        await markDelivered(messageId)
        return
      }
    }
    const expired = await settle(messageId, (record) =>
      record.state === "queued" ? { ...record, state: "expired", withdrawal: "expired" } : record,
    )
    if (expired?.state !== "expired" || !deps.exists(expired.from)) return
    const group = deps.groups.state().groups.get(expired.groupId)
    tellUndelivered([
      {
        from: expired.from,
        messageId,
        toName: nameOf(expired.to),
        groupName: group?.name ?? expired.groupId,
        withdrawal: "expired",
        stopped: deps.stopped(expired.to),
      },
    ])
  }

  const track = (messageId: string) => {
    if (disposed || timers.has(messageId)) return
    const message = deps.groups.state().messages.get(messageId)
    if (message?.state !== "queued") return
    const delay = Math.max(0, message.sentAt + PEER_LIMITS.deliveryMs - deps.now())
    timers.set(
      messageId,
      deps.later(delay, () => {
        expire(messageId).catch((error: unknown) => {
          deps.warn(`bot-core: could not expire peer message "${messageId}": ${messageOf(error)}`)
        })
      }),
    )
  }

  const offWithdrawn = deps.groups.onWithdrawn((list) => {
    withdrawAll(list).catch((error: unknown) => {
      deps.warn(`bot-core: could not withdraw peer messages: ${messageOf(error)}`)
    })
  })

  return {
    start() {
      for (const [messageId, message] of deps.groups.state().messages) {
        if (message.state === "queued") track(messageId)
      }
    },
    track,
    delivered(entry) {
      if (entry.topic !== "peer") return
      for (const messageId of entry.peerMessages ?? []) {
        timers.get(messageId)?.()
        timers.delete(messageId)
        markDelivered(messageId).catch((error: unknown) => {
          deps.warn(
            `bot-core: could not mark peer message "${messageId}" delivered: ${messageOf(error)}`,
          )
        })
      }
    },
    dispose() {
      disposed = true
      offWithdrawn()
      for (const cancel of timers.values()) cancel()
      timers.clear()
    },
  }
}
