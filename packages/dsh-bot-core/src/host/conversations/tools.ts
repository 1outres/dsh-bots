import { z } from "zod"
import type { ConversationToolName } from "../../internal"
import { ConversationToolError } from "./errors"
import {
  type Conversation,
  conversationOf,
  type InContext,
  inContextOf,
  type SessionLog,
} from "./history"
import { parsePeriod } from "./period"
import { renderRead, renderSearch, type UnreadConversation } from "./render"
import { searchConversations } from "./search"
import type { ConversationSource, OwnerConversations } from "./sources"
import { NOT_COMPACTED, NOTHING_COMPACTED, READ_AROUND, SEARCH_LIMIT, UNAVAILABLE } from "./texts"

export type SessionLogReader = (
  sessionId: string,
  signal: AbortSignal,
) => Promise<SessionLog | undefined>

export interface ConversationToolsDeps {
  sources(botId: string, callerId: string): OwnerConversations
  reader(): SessionLogReader | undefined
  timezone(botId: string): string
}

export interface ConversationCall {
  readonly botId: string
  readonly callerId: string
  readonly tool: ConversationToolName
  readonly args: unknown
}

export interface ConversationTools {
  call(request: ConversationCall, signal: AbortSignal): Promise<string>
}

type Loaded =
  | { readonly kind: "read"; readonly conversation: Conversation }
  | ({ readonly kind: "unread" } & UnreadConversation)

const READ_CONCURRENCY = 4

const searchSchema = z.strictObject({
  query: z.string().trim().min(1),
  after: z.string().trim().min(1).optional(),
  before: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(SEARCH_LIMIT.max).optional(),
})

const around = z.number().int().min(0).max(READ_AROUND.max).optional()

const readSchema = z.strictObject({
  session: z.string().trim().min(1),
  message: z.number().int().min(0),
  earlier: around,
  later: around,
})

function parse<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args ?? {})
  if (result.success) return result.data
  const issues = result.error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
  )
  throw new ConversationToolError(`Invalid arguments: ${issues.join("; ")}`)
}

const problemOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const EMPTY_LOG: SessionLog = { inheritedEventCount: 0, events: [] }

interface Caller {
  readonly conversation: Conversation
  readonly inContext: InContext
}

async function inTurns<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}

export function createConversationTools(deps: ConversationToolsDeps): ConversationTools {
  const requireReader = () => {
    const reader = deps.reader()
    if (reader === undefined) throw new ConversationToolError(UNAVAILABLE)
    return reader
  }

  const load = async (
    reader: SessionLogReader,
    source: ConversationSource,
    inContext: InContext,
    signal: AbortSignal,
  ): Promise<Conversation> =>
    conversationOf(source, (await reader(source.sessionId, signal)) ?? EMPTY_LOG, inContext)

  const loadCaller = async (
    reader: SessionLogReader,
    current: ConversationSource,
    signal: AbortSignal,
  ): Promise<Caller> => {
    const log = (await reader(current.sessionId, signal)) ?? EMPTY_LOG
    const inContext = inContextOf(log)
    return { conversation: conversationOf(current, log, inContext), inContext }
  }

  const search = async (request: ConversationCall, signal: AbortSignal) => {
    const input = parse(searchSchema, request.args)
    const timezone = deps.timezone(request.botId)
    const period = parsePeriod(input, timezone)
    const reader = requireReader()
    const { current, others } = deps.sources(request.botId, request.callerId)
    const caller = await loadCaller(reader, current, signal)
    const read = await inTurns(others, READ_CONCURRENCY, async (source): Promise<Loaded> => {
      try {
        return { kind: "read", conversation: await load(reader, source, caller.inContext, signal) }
      } catch (error) {
        signal.throwIfAborted()
        return { kind: "unread", sessionId: source.sessionId, problem: problemOf(error) }
      }
    })
    const conversations = [
      caller.conversation,
      ...read.flatMap((item) => (item.kind === "read" ? [item.conversation] : [])),
    ]
    const unread = read.flatMap((item): UnreadConversation[] =>
      item.kind === "unread" ? [{ sessionId: item.sessionId, problem: item.problem }] : [],
    )
    const outcome = searchConversations(
      conversations,
      input.query,
      period,
      input.limit ?? SEARCH_LIMIT.default,
    )
    return renderSearch(input.query, outcome, unread, timezone)
  }

  const readConversation = async (
    reader: SessionLogReader,
    sources: OwnerConversations,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<Conversation> => {
    const source = [sources.current, ...sources.others].find(
      (candidate) => candidate.sessionId === sessionId,
    )
    if (source === undefined) {
      throw new ConversationToolError(
        `${JSON.stringify(sessionId)} is not one of your past conversations with your owner; use a session id conversation_search showed`,
      )
    }
    const caller = await loadCaller(reader, sources.current, signal)
    if (source !== sources.current) return load(reader, source, caller.inContext, signal)
    if (caller.conversation.messages.length === 0) {
      throw new ConversationToolError(NOTHING_COMPACTED)
    }
    return caller.conversation
  }

  const read = async (request: ConversationCall, signal: AbortSignal) => {
    const input = parse(readSchema, request.args)
    const conversation = await readConversation(
      requireReader(),
      deps.sources(request.botId, request.callerId),
      input.session,
      signal,
    )
    const index = conversation.messages.findIndex((message) => message.seq === input.message)
    if (index < 0) {
      throw new ConversationToolError(
        conversation.kind === "current"
          ? `#${input.message} ${NOT_COMPACTED}`
          : `#${input.message} is not a message of that conversation; use a number conversation_search showed`,
      )
    }
    return renderRead(
      conversation,
      index,
      {
        earlier: input.earlier ?? READ_AROUND.default,
        later: input.later ?? READ_AROUND.default,
      },
      deps.timezone(request.botId),
    )
  }

  const handlers: Readonly<
    Record<
      ConversationToolName,
      (request: ConversationCall, signal: AbortSignal) => Promise<string>
    >
  > = {
    conversation_search: search,
    conversation_read: read,
  }

  return { call: (request, signal) => handlers[request.tool](request, signal) }
}
