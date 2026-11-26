import { z } from "zod"
import type { BotSessionModelRequest } from "../../contract"
import type { SessionToolName, SessionToolRequest, SessionToolResponse } from "../../internal"
import type {
  BotAnswerResult,
  BotInteraction,
  BotInteractionAnswer,
} from "../../shared/interactions"
import {
  type BotManagedSession,
  type BotManagedTarget,
  DEFAULT_ANSWERER,
} from "../../shared/managed-sessions"
import type { BotModelChoice } from "../../shared/models"
import type { BotWorkspaceGrant, DshWorkspace } from "../../shared/workspaces"
import { delegateNamed, modelIdOf } from "../models/delegates"
import type { TranscriptMessage } from "../spoken-messages"
import type { ManagedFollow } from "./follow"
import { type MainMessage, mainMessage, mainMessageLead } from "./messages"
import type { ManagedSessions } from "./sessions"
import { describeInteraction, renderTranscript, transcriptOf } from "./transcript"
import type { DshWait } from "./waits"

export type SessionActivity = "idle" | "running"

export interface ManagedToolsDeps {
  refusal(botId: string, token: string, agentId: string): string | undefined
  sessions: ManagedSessions
  models(botId: string): {
    readonly main: BotModelChoice
    readonly delegates: readonly BotModelChoice[]
  }
  create(botId: string, title: string, model: BotSessionModelRequest): Promise<string>
  createInWorkspace(
    grant: BotWorkspaceGrant,
    options: { readonly title: string; readonly model: BotModelChoice },
  ): Promise<string>
  workspaces(
    botId: string,
  ): readonly { readonly grant: BotWorkspaceGrant; readonly workspace: DshWorkspace }[]
  authority(mainSessionId: string): string | undefined
  botName(botId: string): string
  send(sessionId: string, message: MainMessage, mode: "queue" | "steer"): Promise<void>
  messages(sessionId: string): Promise<readonly TranscriptMessage[]>
  activity(sessionId: string): SessionActivity
  interactions(sessionId: string): readonly BotInteraction[]
  waits(sessionId: string): readonly DshWait[]
  answer(
    sessionId: string,
    interactionId: string,
    answer: BotInteractionAnswer,
  ): Promise<BotAnswerResult>
  stop(sessionId: string): void
  archive(sessionId: string): Promise<void>
  follow: Pick<ManagedFollow, "stopping">
}

export interface ManagedTools {
  available(botId: string, token: string, agentId: string): boolean
  call(botId: string, token: string, request: SessionToolRequest): Promise<SessionToolResponse>
}

export class SessionToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SessionToolError"
  }
}

export const DEFAULT_READ_LIMIT = 10
export const MAX_READ_LIMIT = 50
export const MAX_TITLE_LENGTH = 120

const sessionId = z.string().min(1)
const text = z.string().trim().min(1)

const WORKSPACE_TARGET = /^workspace:(.+)$/

const target = z.union([z.literal("bot"), z.string().regex(WORKSPACE_TARGET)], {
  message: 'target must be "bot" or "workspace:<id>" (see session_list)',
})

const schemas = {
  session_start: z.strictObject({
    target,
    title: text.max(MAX_TITLE_LENGTH),
    instruction: text,
    model: z.string().min(1).optional(),
    answerer: z.enum(["main", "owner"]).optional(),
  }),
  session_send: z.strictObject({
    session_id: sessionId,
    message: text,
    mode: z.enum(["queue", "steer"]).optional(),
  }),
  session_read: z.strictObject({
    session_id: sessionId,
    after: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(MAX_READ_LIMIT).optional(),
  }),
  session_answer: z.strictObject({
    session_id: sessionId,
    interaction_id: z.string().min(1),
    answers: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          selected: z.array(z.string()),
          custom: z.string().optional(),
        }),
      )
      .optional(),
    approved: z.boolean().optional(),
    feedback: z.string().optional(),
  }),
  session_stop: z.strictObject({ session_id: sessionId }),
  session_list: z.strictObject({}),
  session_release: z.strictObject({ session_id: sessionId, archive: z.boolean().optional() }),
} as const satisfies { readonly [Tool in SessionToolName]: z.ZodType }

function parse<T>(schema: z.ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args ?? {})
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const at = issue?.path.length ? `${issue.path.join(".")}: ` : ""
  throw new SessionToolError(`${at}${issue?.message ?? "invalid arguments"}`)
}

function targetOf(value: string): BotManagedTarget {
  const workspace = WORKSPACE_TARGET.exec(value)
  return workspace === null
    ? { kind: "bot" }
    : { kind: "workspace", workspaceId: workspace[1] as string }
}

const ORIGIN_TEXT = { main: "started by you", owner: "handed over by your owner" } as const
const ANSWERER_TEXT = { main: "you", owner: "your owner" } as const

function answerOf(
  interaction: BotInteraction,
  args: z.infer<(typeof schemas)["session_answer"]>,
): BotInteractionAnswer {
  switch (interaction.kind) {
    case "question":
      if (args.answers === undefined) {
        throw new SessionToolError("answers: give one answer per question of this interaction")
      }
      return {
        kind: "question",
        answers: args.answers.map((item) => ({
          id: item.id,
          selected: item.selected,
          ...(item.custom === undefined ? {} : { custom: item.custom }),
        })),
      }
    case "plan-review":
      if (args.approved === undefined) {
        throw new SessionToolError("approved: approve (true) or reject (false) the plan")
      }
      return {
        kind: "plan-review",
        approved: args.approved,
        ...(args.feedback === undefined ? {} : { feedback: args.feedback }),
      }
    case "approval":
      throw new SessionToolError("approvals are answered by your owner in the Web UI")
  }
}

const PERMISSION_TEXT = (grant: BotWorkspaceGrant) =>
  `sandbox ${grant.permission.sandbox}, approval ${grant.permission.approval}`

export function createManagedTools(deps: ManagedToolsDeps): ManagedTools {
  const stateOf = (session: BotManagedSession) =>
    deps.interactions(session.sessionId).some((interaction) => interaction.kind !== "approval") ||
    deps.waits(session.sessionId).length > 0
      ? "waiting"
      : deps.activity(session.sessionId)

  const placeText = (session: BotManagedSession) =>
    session.target.kind === "workspace" ? ` (Workspace ${session.target.workspaceId})` : ""

  const describe = (session: BotManagedSession) =>
    `- ${session.sessionId}${session.label === undefined ? "" : ` "${session.label}"`}${placeText(session)}: ${ORIGIN_TEXT[session.origin]}; questions answered by ${ANSWERER_TEXT[session.answerer]}; ${stateOf(session)}`

  const describeWorkspace = ({
    grant,
    workspace,
  }: {
    readonly grant: BotWorkspaceGrant
    readonly workspace: DshWorkspace
  }) =>
    `- workspace:${workspace.workspaceId} "${workspace.title}" at ${workspace.path}: Agent preset ${grant.agentPreset}, ${PERMISSION_TEXT(grant)}, model ${modelIdOf(grant.model)}`

  const authorize = (mainSessionId: string, target: BotManagedTarget) => {
    if (target.kind !== "workspace") return
    const refused = deps.authority(mainSessionId)
    if (refused !== undefined) throw new SessionToolError(refused)
  }

  const delegate = (botId: string, id: string): BotModelChoice => {
    const { delegates } = deps.models(botId)
    const choice = delegateNamed(delegates, id)
    if (choice !== undefined) return choice
    throw new SessionToolError(
      delegates.length === 0
        ? "model: this bot has no delegate models, so omit model; your owner adds delegates in the bot's settings"
        : `model: "${id}" is not one of your delegate models: ${delegates.map(modelIdOf).join(", ")}`,
    )
  }

  const create = async (
    botId: string,
    target: BotManagedTarget,
    input: { readonly title: string; readonly model?: string },
  ): Promise<string> => {
    if (target.kind === "bot") {
      const model: BotSessionModelRequest =
        input.model === undefined
          ? { role: "main" }
          : { role: "delegate", choice: delegate(botId, input.model) }
      return deps.create(botId, input.title, model)
    }
    const granted = deps
      .workspaces(botId)
      .find(({ workspace }) => workspace.workspaceId === target.workspaceId)
    if (granted === undefined) {
      throw new SessionToolError(
        `target: Workspace "${target.workspaceId}" is not one granted to you (see session_list)`,
      )
    }
    return deps.createInWorkspace(granted.grant, {
      title: input.title,
      model: input.model === undefined ? granted.grant.model : delegate(botId, input.model),
    })
  }

  const send = (session: BotManagedSession, text: string, mode: "queue" | "steer") =>
    deps.send(
      session.sessionId,
      mainMessage(text, mainMessageLead(session.target, deps.botName(session.botId))),
      mode,
    )

  const managed = (botId: string, mainSessionId: string, sessionId: string) => {
    const session = deps.sessions.require(botId, sessionId)
    authorize(mainSessionId, session.target)
    return session
  }

  const run = async (
    botId: string,
    mainSessionId: string,
    tool: SessionToolName,
    args: unknown,
  ): Promise<SessionToolResponse> => {
    switch (tool) {
      case "session_start": {
        const input = parse(schemas.session_start, args)
        const target = targetOf(input.target)
        authorize(mainSessionId, target)
        const created = await create(botId, target, input)
        const session = await deps.sessions.start(botId, created, {
          target,
          answerer: input.answerer ?? DEFAULT_ANSWERER[target.kind],
          label: input.title,
        })
        await send(session, input.instruction, "queue")
        return {
          text: `Started session ${created} "${input.title}"; its turn is running. When it ends, a [session] notice reaches you.`,
          data: { session },
        }
      }
      case "session_send": {
        const input = parse(schemas.session_send, args)
        const session = managed(botId, mainSessionId, input.session_id)
        await send(session, input.message, input.mode ?? "queue")
        return { text: `Sent to session ${session.sessionId}.`, data: { sent: session.sessionId } }
      }
      case "session_read": {
        const input = parse(schemas.session_read, args)
        const session = managed(botId, mainSessionId, input.session_id)
        const transcript = transcriptOf(await deps.messages(session.sessionId), {
          ...(input.after === undefined ? {} : { after: input.after }),
          limit: input.limit ?? DEFAULT_READ_LIMIT,
        })
        const waiting = deps.interactions(session.sessionId)
        const inDsh = deps.waits(session.sessionId)
        const lines = [
          `Session ${session.sessionId}${placeText(session)}: ${stateOf(session)}; questions answered by ${ANSWERER_TEXT[session.answerer]}.`,
          ...(waiting.length === 0
            ? []
            : ["Waiting for an answer:", ...waiting.map(describeInteraction)]),
          ...(inDsh.length === 0
            ? []
            : [
                "Waiting for your owner in the Web UI:",
                ...inDsh.map((wait) => `- ${wait.kind}: ${wait.summary}`),
              ]),
          renderTranscript(transcript),
          ...(transcript.cursor === undefined ? [] : [`cursor: ${transcript.cursor}`]),
        ]
        return {
          text: lines.join("\n"),
          data: { state: stateOf(session), waiting, waitingForOwner: inDsh, ...transcript },
        }
      }
      case "session_answer": {
        const input = parse(schemas.session_answer, args)
        const session = managed(botId, mainSessionId, input.session_id)
        if (session.answerer !== "main") {
          throw new SessionToolError(
            "your owner answers the questions of this session in the Web UI",
          )
        }
        const interaction = deps
          .interactions(session.sessionId)
          .find((open) => open.id === input.interaction_id)
        if (interaction === undefined) {
          throw new SessionToolError(
            `interaction "${input.interaction_id}" is not waiting in this session (see session_read)`,
          )
        }
        const result = await deps.answer(
          session.sessionId,
          interaction.id,
          answerOf(interaction, input),
        )
        if (!result.accepted) throw new SessionToolError(result.message)
        return { text: "Answered.", data: { answered: interaction.id } }
      }
      case "session_stop": {
        const input = parse(schemas.session_stop, args)
        const session = managed(botId, mainSessionId, input.session_id)
        if (deps.activity(session.sessionId) !== "running") {
          return { text: "It runs no turn.", data: { stopped: false } }
        }
        deps.follow.stopping(session.sessionId)
        deps.stop(session.sessionId)
        return { text: "Stopped its turn.", data: { stopped: true } }
      }
      case "session_list": {
        parse(schemas.session_list, args)
        const refused = deps.authority(mainSessionId)
        const sessions = deps.sessions
          .list(botId)
          .filter((session) => refused === undefined || session.target.kind === "bot")
        const workspaces = refused === undefined ? deps.workspaces(botId) : []
        const { main, delegates } = deps.models(botId)
        return {
          text: [
            sessions.length === 0 ? "You manage no sessions." : "Sessions you manage:",
            ...sessions.map(describe),
            ...(refused !== undefined
              ? [`Workspace sessions are not listed: ${refused}.`]
              : workspaces.length === 0
                ? []
                : [
                    'Workspaces you may start sessions in (target "workspace:<id>"; omitting model there uses the Workspace\'s model):',
                    ...workspaces.map(describeWorkspace),
                  ]),
            `Models for session_start: omit model for your main model (${modelIdOf(main)})${delegates.length === 0 ? "; you have no delegate models" : `, or one of your delegates: ${delegates.map(modelIdOf).join(", ")}`}.`,
          ].join("\n"),
          data: {
            sessions: sessions.map((session) => ({ ...session, state: stateOf(session) })),
            workspaces: workspaces.map(({ grant, workspace }) => ({
              ...workspace,
              agentPreset: grant.agentPreset,
              permission: grant.permission,
              model: modelIdOf(grant.model),
            })),
            models: { main: modelIdOf(main), delegates: delegates.map(modelIdOf) },
          },
        }
      }
      case "session_release": {
        const input = parse(schemas.session_release, args)
        const session = managed(botId, mainSessionId, input.session_id)
        await deps.sessions.release(botId, session.sessionId, "main")
        if (input.archive === true) await deps.archive(session.sessionId)
        return {
          text: input.archive === true ? "Released and archived." : "Released.",
          data: { released: session.sessionId, archived: input.archive === true },
        }
      }
    }
  }

  return {
    available: (botId, token, agentId) => deps.refusal(botId, token, agentId) === undefined,
    async call(botId, token, request) {
      const refused = deps.refusal(botId, token, request.agentId)
      if (refused !== undefined) throw new SessionToolError(refused)
      return run(botId, request.agentId, request.tool, request.args)
    },
  }
}
