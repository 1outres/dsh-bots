import { z } from "zod"

const targetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bot") }),
  z.object({ kind: z.literal("workspace"), workspaceId: z.string().min(1) }),
])

/**
 * One session a bot's Main session manages, keyed by session id
 * (docs/specs/bot-managed-sessions.md §3).
 */
export const managedSessionRecordSchema = z.object({
  botId: z.string().min(1),
  target: targetSchema,
  answerer: z.enum(["main", "owner"]),
  origin: z.enum(["main", "owner"]),
  label: z.string().min(1).optional(),
  since: z.number().int().nonnegative(),
})

export type ManagedSessionRecord = z.infer<typeof managedSessionRecordSchema>

const choiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("profile-default") }),
  z.object({
    kind: z.literal("fixed"),
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).optional(),
  }),
])

/** A DSH Workspace the owner granted a bot, keyed by {@link grantKey} (§10). */
export const workspaceGrantRecordSchema = z.object({
  botId: z.string().min(1),
  workspaceId: z.string().min(1),
  agentPreset: z.string().min(1),
  permission: z.object({
    sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]),
    approval: z.enum(["ask", "never"]),
  }),
  model: choiceSchema,
  since: z.number().int().nonnegative(),
})

export type WorkspaceGrantRecord = z.infer<typeof workspaceGrantRecordSchema>

/** The key of a bot's grant of a Workspace (ids never hold "/"). */
export const grantKey = (botId: string, workspaceId: string) => `${botId}/${workspaceId}`

/**
 * bot-core's managed sessions (design rule 27). Version 2 added the
 * `workspace` target and the `workspaces` grants; every version 1 record
 * is a valid version 2 one, hence `compatibleVersions`.
 */
export const MANAGED_SESSIONS_DOMAIN = {
  name: "dsh_bot_managed_sessions",
  version: 2,
  compatibleVersions: [1],
  invalidRecords: "backup-and-skip",
  tables: {
    sessions: { valueSchema: managedSessionRecordSchema },
    workspaces: { valueSchema: workspaceGrantRecordSchema },
  },
} as const
