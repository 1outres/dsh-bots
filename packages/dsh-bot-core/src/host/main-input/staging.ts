import type { BotInboundAttachment } from "../../channel-contract"
import type {
  MainAppendResult,
  MainInputFailure,
  MainStageRequest,
  MainStageResult,
} from "../../shared/main-input"
import type { AttachmentFacts } from "../channels/inbound"

export interface StagedAttachment {
  readonly id: string
  readonly draft: string
  readonly name: string
  readonly mediaType?: string
  readonly bytes: number
  readonly chunks: readonly Uint8Array[]
  readonly received: number
  readonly touchedAt: number
}

export type StagingState = ReadonlyMap<string, readonly StagedAttachment[]>

export interface StagingRules {
  readonly ttlMs: number
  readonly chunkBytes: number
  check(attachments: readonly AttachmentFacts[]): MainInputFailure | undefined
}

export type Resolved =
  | { readonly ok: true; readonly attachments: readonly BotInboundAttachment[] }
  | { readonly ok: false; readonly failure: MainInputFailure }

const failure = (code: MainInputFailure["code"], message: string): MainInputFailure => ({
  code,
  message,
})

const quote = (value: string) => JSON.stringify(value)

export const isComplete = (attachment: StagedAttachment) => attachment.received === attachment.bytes

export function sweep(state: StagingState, now: number, ttlMs: number): StagingState {
  const next = new Map<string, readonly StagedAttachment[]>()
  for (const [botId, staged] of state) {
    const kept = staged.filter((attachment) => now - attachment.touchedAt < ttlMs)
    if (kept.length > 0) next.set(botId, kept)
  }
  return next
}

function replaced(
  state: StagingState,
  botId: string,
  staged: readonly StagedAttachment[],
): StagingState {
  const next = new Map(state)
  if (staged.length === 0) next.delete(botId)
  else next.set(botId, staged)
  return next
}

export function stageIn(
  state: StagingState,
  rules: StagingRules,
  botId: string,
  request: MainStageRequest,
  id: string,
  now: number,
): { readonly state: StagingState; readonly result: MainStageResult } {
  if (!Number.isSafeInteger(request.bytes) || request.bytes < 0) {
    return {
      state,
      result: { staged: false, failure: failure("unreadable", "The file's size is not valid.") },
    }
  }
  const staged = state.get(botId) ?? []
  const attachment: StagedAttachment = {
    id,
    draft: request.draft,
    name: request.name,
    ...(request.mediaType === undefined ? {} : { mediaType: request.mediaType }),
    bytes: request.bytes,
    chunks: [],
    received: 0,
    touchedAt: now,
  }
  const refused = rules.check([
    ...staged.filter((entry) => entry.draft === request.draft),
    attachment,
  ])
  if (refused !== undefined) return { state, result: { staged: false, failure: refused } }
  return {
    state: replaced(state, botId, [...staged, attachment]),
    result: { staged: true, attachmentId: id },
  }
}

export function appendIn(
  state: StagingState,
  rules: StagingRules,
  botId: string,
  attachmentId: string,
  offset: number,
  data: Uint8Array,
  now: number,
): { readonly state: StagingState; readonly result: MainAppendResult } {
  const staged = state.get(botId) ?? []
  const attachment = staged.find((entry) => entry.id === attachmentId)
  const refuse = (code: MainInputFailure["code"], message: string) => ({
    state,
    result: { appended: false, failure: failure(code, message) } as const,
  })
  if (attachment === undefined) {
    return refuse("unknown-attachment", "The attachment is no longer staged. Add it again.")
  }
  if (data.byteLength > rules.chunkBytes) {
    return refuse("too-large", `A chunk is larger than ${rules.chunkBytes} bytes.`)
  }
  if (offset !== attachment.received) {
    return refuse(
      "incomplete-attachment",
      `${quote(attachment.name)} expected bytes from ${attachment.received}, not ${offset}.`,
    )
  }
  if (attachment.received + data.byteLength > attachment.bytes) {
    return refuse("too-large", `${quote(attachment.name)} is larger than it said it was.`)
  }
  const grown: StagedAttachment = {
    ...attachment,
    chunks: [...attachment.chunks, data],
    received: attachment.received + data.byteLength,
    touchedAt: now,
  }
  return {
    state: replaced(
      state,
      botId,
      staged.map((entry) => (entry.id === attachmentId ? grown : entry)),
    ),
    result: { appended: true, received: grown.received, complete: isComplete(grown) },
  }
}

export function discardIn(
  state: StagingState,
  botId: string,
  attachmentIds: readonly string[],
): StagingState {
  const staged = state.get(botId) ?? []
  return replaced(
    state,
    botId,
    staged.filter((entry) => !attachmentIds.includes(entry.id)),
  )
}

function joined(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  const data = new Uint8Array(bytes)
  let at = 0
  for (const chunk of chunks) {
    data.set(chunk, at)
    at += chunk.byteLength
  }
  return data
}

export function resolveIn(
  state: StagingState,
  botId: string,
  attachmentIds: readonly string[],
): Resolved {
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    return { ok: false, failure: failure("unknown-attachment", "An attachment is listed twice.") }
  }
  const staged = state.get(botId) ?? []
  const attachments: BotInboundAttachment[] = []
  for (const id of attachmentIds) {
    const attachment = staged.find((entry) => entry.id === id)
    if (attachment === undefined) {
      return {
        ok: false,
        failure: failure("unknown-attachment", "An attachment is no longer staged. Add it again."),
      }
    }
    if (!isComplete(attachment)) {
      return {
        ok: false,
        failure: failure(
          "incomplete-attachment",
          `${quote(attachment.name)} has not finished uploading.`,
        ),
      }
    }
    const data = joined(attachment.chunks, attachment.bytes)
    attachments.push({
      name: attachment.name,
      ...(attachment.mediaType === undefined ? {} : { mediaType: attachment.mediaType }),
      bytes: attachment.bytes,
      async read(maxBytes) {
        if (data.byteLength > maxBytes) throw new Error(`it is larger than ${maxBytes} bytes`)
        return data
      },
    })
  }
  return { ok: true, attachments }
}

export interface InputStagingDeps {
  readonly rules: () => StagingRules
  now(): number
  newId(): string
}

export interface InputStaging {
  stage(botId: string, request: MainStageRequest): MainStageResult
  append(botId: string, attachmentId: string, offset: number, data: Uint8Array): MainAppendResult
  discard(botId: string, attachmentId: string): boolean
  resolve(botId: string, attachmentIds: readonly string[]): Resolved
  release(botId: string, attachmentIds: readonly string[]): void
}

export function createInputStaging(deps: InputStagingDeps): InputStaging {
  let state: StagingState = new Map()
  const current = () => {
    state = sweep(state, deps.now(), deps.rules().ttlMs)
    return state
  }
  return {
    stage(botId, request) {
      const next = stageIn(current(), deps.rules(), botId, request, deps.newId(), deps.now())
      state = next.state
      return next.result
    },
    append(botId, attachmentId, offset, data) {
      const next = appendIn(current(), deps.rules(), botId, attachmentId, offset, data, deps.now())
      state = next.state
      return next.result
    },
    discard(botId, attachmentId) {
      const before = current().get(botId)?.length ?? 0
      state = discardIn(state, botId, [attachmentId])
      return (state.get(botId)?.length ?? 0) < before
    },
    resolve: (botId, attachmentIds) => resolveIn(current(), botId, attachmentIds),
    release(botId, attachmentIds) {
      state = discardIn(current(), botId, attachmentIds)
    },
  }
}
