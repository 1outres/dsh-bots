import { z } from "zod"
import type { PeerToolRequest, PeerToolResponse } from "../../internal"
import type { NoticeWithdrawal } from "../notices/delivery"
import type { NoticeContent, NoticeOrigin } from "../notices/outbox"
import type { PartyTurn } from "../turns/parties"
import type { PeerMessageRecord } from "./domain"
import { membersOf, type PeerGroups, requireGroup, sharedGroupOf } from "./groups"
import { judgePeerSend, PEER_LIMITS, type PeerRefusalReason } from "./limits"
import { groupPausedNotice, pairPausedNotice, peerMessageNotice, refusalText } from "./notice"
import { newThreadDepth, peerOriginOf } from "./origin"
import type { PeerPairPauses } from "./pair-pauses"
import type { PeerState, PeerStore } from "./store"

export type PeerStatusTopic = "peer" | "peer-status"

export interface PeerNotices {
  enqueue(
    botId: string,
    topic: PeerStatusTopic,
    notice: NoticeContent,
    origin?: NoticeOrigin,
  ): Promise<{ readonly id: string }>
  withdraw(noticeId: string): Promise<NoticeWithdrawal>
}

export interface PeerSendDeps {
  refusal(botId: string, token: string, agentId: string): string | undefined
  groups: Pick<PeerGroups, "state" | "pauseForLimit">
  store: Pick<PeerStore, "change">
  pairPauses: Pick<PeerPairPauses, "pause" | "until">
  turn(agentId: string): PartyTurn | undefined
  botName(botId: string): string
  timezone(botId: string): string
  stopped(botId: string): boolean
  shield(botId: string, text: string): Promise<string>
  notices: PeerNotices
  track(messageId: string): void
  newId(): string
  now(): number
  warn(message: string): void
}

export interface PeerSend {
  available(botId: string, token: string, agentId: string): boolean
  call(botId: string, token: string, request: PeerToolRequest): Promise<PeerToolResponse>
}

export class PeerToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PeerToolError"
  }
}

const argsSchema = z.strictObject({
  to: z.string().min(1),
  message: z.string(),
  reply_to: z.string().min(1).optional(),
  expects_reply: z.boolean().optional(),
})

type PeerSendArgs = z.infer<typeof argsSchema>

function parseArgs(args: unknown): PeerSendArgs {
  const parsed = argsSchema.safeParse(args)
  if (parsed.success) return parsed.data
  throw new PeerToolError(
    `Invalid arguments: ${parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
      .join("; ")}`,
  )
}

function checkText(text: string): void {
  if (text.trim() === "") throw new PeerToolError("message: write the message; it is empty")
  const length = [...text].length
  if (length > PEER_LIMITS.messageLength) {
    throw new PeerToolError(
      `message: ${length} characters is over the limit of ${PEER_LIMITS.messageLength}; shorten it, or say what the peer needs and send the rest later`,
    )
  }
}

interface Addressed {
  readonly groupId: string
  readonly replied: PeerMessageRecord | undefined
}

function address(
  state: PeerState,
  botId: string,
  args: PeerSendArgs,
  name: (botId: string) => string,
): Addressed {
  if (!state.members.has(botId)) {
    throw new PeerToolError(
      "Not sent: you are in no group, so you have no peer bots to message. Tell your owner if you need one.",
    )
  }
  if (args.to === botId) throw new PeerToolError("Not sent: to is your own bot id.")
  const groupId = sharedGroupOf(state, botId, args.to)
  if (groupId === undefined) {
    throw new PeerToolError(
      `Not sent: "${args.to}" is not a bot in your group; use a bot id listed under "Peer bots".`,
    )
  }
  if (args.reply_to === undefined) return { groupId, replied: undefined }
  const replied = state.messages.get(args.reply_to)
  if (
    replied === undefined ||
    replied.groupId !== groupId ||
    replied.from !== args.to ||
    replied.to !== botId ||
    replied.state !== "delivered"
  ) {
    throw new PeerToolError(
      `Not sent: reply_to "${args.reply_to}" is not a message ${name(args.to)} sent you in this group; give the id from its [peer] notice, or leave reply_to out to start a new thread.`,
    )
  }
  return { groupId, replied }
}

interface Decided {
  readonly messageId: string
  readonly record: PeerMessageRecord
  readonly groupName: string
  readonly replied: PeerMessageRecord | undefined
  readonly refused: PeerRefusalReason | undefined
}

export function createPeerSend(deps: PeerSendDeps): PeerSend {
  const tell = (botId: string, notice: NoticeContent) => {
    deps.notices.enqueue(botId, "peer-status", notice).catch((error: unknown) => {
      deps.warn(`bot-core: could not tell bot "${botId}" about its peer messages: ${String(error)}`)
    })
  }

  const pause = async (decided: Decided, reason: PeerRefusalReason) => {
    const { record } = decided
    if (reason.refusal === "pair" && reason.starts) {
      deps.pairPauses.pause(record.from, record.to, reason.until)
      for (const [self, other] of [
        [record.from, record.to],
        [record.to, record.from],
      ] as const) {
        tell(
          self,
          pairPausedNotice(deps.botName(other), reason.until, reason.count, deps.timezone(self)),
        )
      }
      return
    }
    if (reason.refusal !== "group") return
    if (!(await deps.groups.pauseForLimit(record.groupId, "group"))) return
    for (const { botId } of membersOf(deps.groups.state(), record.groupId)) {
      tell(botId, groupPausedNotice(decided.groupName, reason.count))
    }
  }

  const decide = (
    botId: string,
    args: PeerSendArgs,
    text: string,
    depth: number | undefined,
    messageId: string,
  ) =>
    deps.store.change((state) => {
      const { groupId, replied } = address(state, botId, args, deps.botName)
      const group = requireGroup(state, groupId)
      const now = deps.now()
      const threadId = replied?.threadId ?? messageId
      const verdict = judgePeerSend(state.messages.values(), now, {
        groupId,
        from: botId,
        to: args.to,
        threadId,
        replying: replied !== undefined,
        depth,
        groupPause: group.paused,
        pairPausedUntil: deps.pairPauses.until(botId, args.to),
      })
      const refused = verdict.kind === "refused" ? verdict.reason : undefined
      const record: PeerMessageRecord = {
        groupId,
        from: botId,
        to: args.to,
        threadId,
        ...(args.reply_to === undefined ? {} : { replyTo: args.reply_to }),
        expectsReply: args.expects_reply ?? args.reply_to === undefined,
        depth: depth ?? PEER_LIMITS.maxDepth + 1,
        text,
        sentAt: now,
        ...(refused === undefined
          ? { state: "queued" as const }
          : { state: "refused" as const, refusal: refused.refusal }),
      }
      const decided: Decided = { messageId, record, groupName: group.name, replied, refused }
      return { writes: [{ kind: "put-message", messageId, record }], result: decided }
    })

  const deliver = async (decided: Decided) => {
    const { messageId, record } = decided
    let noticeId: string
    try {
      const entry = await deps.notices.enqueue(
        record.to,
        "peer",
        peerMessageNotice({
          messageId,
          message: record,
          fromName: deps.botName(record.from),
          groupName: decided.groupName,
          replied: decided.replied,
        }),
        { peerMessages: [messageId] },
      )
      noticeId = entry.id
    } catch (error) {
      await deps.store.change(() => ({
        writes: [{ kind: "delete-message", messageId }],
        result: undefined,
      }))
      throw new PeerToolError(
        `Not sent: bot-core could not queue the message: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const kept = await deps.store.change((state) => {
      const current = state.messages.get(messageId)
      if (current?.state !== "queued") return { writes: [], result: false }
      return {
        writes: [{ kind: "put-message", messageId, record: { ...current, noticeId } }],
        result: true,
      }
    })
    if (kept) deps.track(messageId)
    else await deps.notices.withdraw(noticeId)
  }

  const send = async (
    botId: string,
    agentId: string,
    args: PeerSendArgs,
  ): Promise<PeerToolResponse> => {
    checkText(args.message)
    const before = deps.groups.state()
    const { replied } = address(before, botId, args, deps.botName)
    const depth =
      replied === undefined
        ? newThreadDepth(before, peerOriginOf(before, deps.turn(agentId)))
        : replied.depth
    const text = await deps.shield(botId, args.message)
    const messageId = `p_${deps.newId()}`
    const decided = await decide(botId, args, text, depth, messageId)
    const toName = deps.botName(args.to)
    if (decided.refused !== undefined) {
      await pause(decided, decided.refused).catch((error: unknown) => {
        deps.warn(`bot-core: could not pause peer messages: ${String(error)}`)
      })
      throw new PeerToolError(
        refusalText(decided.refused, {
          toName,
          groupName: decided.groupName,
          threadId: decided.record.threadId,
          timezone: deps.timezone(botId),
        }),
      )
    }
    await deliver(decided)
    const reaches = deps.stopped(args.to)
    const second = reaches
      ? `${toName}'s machine is stopped now: the message waits until it is back, for up to 24 hours.`
      : `It reaches ${toName}'s Main session after its current turn; a reply, if any, comes back here as a [peer] notice.`
    return {
      text: `Sent ${messageId} to ${toName} (thread ${decided.record.threadId}). ${second} Do not wait for it in this turn.`,
      data: { sent: messageId, thread: decided.record.threadId },
    }
  }

  return {
    available: (botId, token, agentId) => deps.refusal(botId, token, agentId) === undefined,
    async call(botId, token, request) {
      const refused = deps.refusal(botId, token, request.agentId)
      if (refused !== undefined) throw new PeerToolError(refused)
      return send(botId, request.agentId, parseArgs(request.args))
    },
  }
}
