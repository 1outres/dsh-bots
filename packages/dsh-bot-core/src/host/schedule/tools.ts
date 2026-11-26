import { z } from "zod"
import type { ScheduleToolName, ScheduleToolRequest, ScheduleToolResponse } from "../../internal"
import type { ScheduleJob } from "./domain"
import {
  changedJob,
  createInputSchema,
  describeJob,
  jobView,
  MAX_JOBS_PER_BOT,
  newJob,
  parseInput,
  UPCOMING_COUNT,
  updateInputSchema,
} from "./jobs"
import type { ScheduleResult, ScheduleRunner } from "./runner"
import type { ScheduleStore } from "./store"
import { InvalidScheduleError } from "./timing"

export const SCHEDULE_ACTIONS = ["create", "list", "update", "delete", "run"] as const

export type ScheduleCaller =
  | { readonly kind: "main"; readonly sessionId: string }
  | { readonly kind: "run"; readonly sessionId: string; readonly jobId: string }
  | { readonly kind: "refused"; readonly reason: string }

export interface ScheduleToolsDeps {
  caller(botId: string, token: string, agentId: string): ScheduleCaller
  store: ScheduleStore
  runner: Pick<ScheduleRunner, "isRunning" | "start" | "result">
  changed(): void
  botTimezone(botId: string): string
  now(): number
  newId(): string
  warn(message: string): void
}

export interface ScheduleTools {
  available(botId: string, token: string, agentId: string, tool: ScheduleToolName): boolean
  call(botId: string, token: string, request: ScheduleToolRequest): Promise<ScheduleToolResponse>
}

const actionSchema = z.looseObject({
  action: z.enum(SCHEDULE_ACTIONS),
  id: z.string().min(1).optional(),
})

const resultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("report"), report: z.string().trim().min(1) }),
  z.strictObject({ outcome: z.literal("nothing") }),
])

export function createScheduleTools(deps: ScheduleToolsDeps): ScheduleTools {
  const view = (job: ScheduleJob) => jobView(job, deps.store.runs(job.id)[0], UPCOMING_COUNT)

  const requireJob = (botId: string, id: string | undefined): ScheduleJob => {
    if (id === undefined) throw new InvalidScheduleError("id: give the job's id (see list)")
    const job = deps.store.job(id)
    if (job === undefined || job.botId !== botId) throw new InvalidScheduleError(`no job "${id}"`)
    return job
  }

  const answer = (job: ScheduleJob, lead: string, key = "job"): ScheduleToolResponse => {
    const shown = view(job)
    return { text: `${lead}\n${describeJob(shown)}`, data: { [key]: shown } }
  }

  const schedule = async (
    botId: string,
    caller: Exclude<ScheduleCaller, { kind: "refused" }>,
    args: unknown,
  ): Promise<ScheduleToolResponse> => {
    const parsed = parseInput(actionSchema, args)
    const { action, id, ...fields } = parsed
    if (caller.kind === "run") {
      if (action !== "update" && action !== "delete") {
        throw new InvalidScheduleError(
          "in a scheduled run's session, schedule can only update or delete this run's own job",
        )
      }
      if (id !== undefined && id !== caller.jobId) {
        throw new InvalidScheduleError(
          "in a scheduled run's session, only this run's own job can be changed",
        )
      }
    }
    const target = caller.kind === "run" ? caller.jobId : id
    const now = deps.now()
    switch (action) {
      case "create": {
        if (deps.store.jobs(botId).length >= MAX_JOBS_PER_BOT) {
          throw new InvalidScheduleError(
            `this bot already has ${MAX_JOBS_PER_BOT} jobs; delete one before creating another`,
          )
        }
        const record = newJob(parseInput(createInputSchema, fields), {
          botId,
          sessionId: caller.sessionId,
          botTimezone: deps.botTimezone(botId),
          now,
        })
        const job = await deps.store.putJob(deps.newId(), record)
        deps.changed()
        return answer(job, "Created.")
      }
      case "list": {
        const jobs = deps.store.jobs(botId).map(view)
        return {
          text: jobs.length === 0 ? "No jobs." : jobs.map(describeJob).join("\n"),
          data: { jobs },
        }
      }
      case "update": {
        const job = requireJob(botId, target)
        const record = changedJob(job, parseInput(updateInputSchema, fields), now)
        const updated = await deps.store.putJob(job.id, record)
        deps.changed()
        return answer(updated, "Updated.")
      }
      case "delete": {
        const job = requireJob(botId, target)
        const shown = view(job)
        await deps.store.deleteJob(job.id)
        deps.changed()
        return { text: `Deleted.\n${describeJob(shown)}`, data: { deleted: shown } }
      }
      case "run": {
        const job = requireJob(botId, target)
        if (deps.runner.isRunning(job.id)) {
          throw new InvalidScheduleError(`a run of "${job.name}" is still running`)
        }
        deps.runner.start(job, "manual", now).catch((error: unknown) => {
          deps.warn(`bot-core: the run of schedule job "${job.id}" failed: ${String(error)}`)
        })
        return {
          text: `Started a run of "${job.name}"; its outcome reaches you later as a notice.`,
          data: { started: job.id },
        }
      }
    }
  }

  return {
    available(botId, token, agentId, tool) {
      const caller = deps.caller(botId, token, agentId)
      return tool === "schedule" ? caller.kind !== "refused" : caller.kind === "run"
    },
    async call(botId, token, request) {
      const caller = deps.caller(botId, token, request.agentId)
      if (caller.kind === "refused") throw new Error(caller.reason)
      if (request.tool === "schedule") return schedule(botId, caller, request.args)
      if (caller.kind !== "run") {
        throw new Error("schedule_result works only in the session of a scheduled separate run")
      }
      const result: ScheduleResult = parseInput(resultSchema, request.args)
      deps.runner.result(caller.sessionId, result)
      return {
        text:
          result.outcome === "report"
            ? "Recorded; the report goes to your Main session when this turn ends."
            : "Recorded: nothing to report.",
        data: { outcome: result.outcome },
      }
    },
  }
}
