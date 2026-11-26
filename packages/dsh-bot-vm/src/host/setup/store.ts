import type {
  HostSiteView,
  SetupFailure,
  SetupJobState,
  SetupLogLine,
  SetupStepState,
  SetupStepView,
} from "@1outres/dsh-bot-core"
import { parseProjectName } from "../backend/incus/endpoint"
import { HOST_SETUP_FACT_KEYS, SETUP_FAILURE_CODES } from "./events"
import {
  type HostRun,
  ROOT_PHASES,
  type RootPhase,
  SETUP_STEPS,
  type SetupFacts,
  type SetupJob,
} from "./job"
import type { SetupTarget, TargetSite } from "./site"

export interface SetupFiles {
  read(path: string): Promise<string | undefined>
  write(path: string, content: string, mode: number): Promise<void>
  append(path: string, content: string, mode: number, capBytes: number): Promise<void>
  mkdir(path: string, mode: number): Promise<void>
  list(dir: string): Promise<readonly string[]>
  remove(path: string): Promise<void>
}

export interface StoredJob {
  readonly job: SetupJob
  readonly lines: number
}

export interface JobFile {
  readonly path: string
  readonly content: string
  readonly mode: number
}

export interface SetupJobStore {
  dir(jobId: string): string
  attach(jobId: string, files: readonly JobFile[]): Promise<void>
  load(): Promise<readonly StoredJob[]>
  save(job: SetupJob, lines: number): Promise<void>
  append(jobId: string, lines: readonly SetupLogLine[]): Promise<void>
  tail(jobId: string, count: number): Promise<readonly SetupLogLine[]>
  remove(jobId: string): Promise<void>
}

export const JOB_FILE = "job.json"
export const LOG_FILE = "log.txt"
export const LOG_CAP_BYTES = 2 * 1024 * 1024
const JOB_VERSION = 1
const JOB_ID = /^[0-9a-f]{16,64}$/
const ATTACHED_PATH = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/
const RESERVED = new Set([JOB_FILE, LOG_FILE])

type Fields = Readonly<Record<string, unknown>>

function fields(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`)
  }
  return value as Fields
}

function text(record: Fields, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`${what}: "${key}" is not text`)
  return value
}

function count(record: Fields, key: string, what: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${what}: "${key}" is not a whole number`)
  }
  return value
}

function optionalCount(record: Fields, key: string, what: string) {
  return record[key] === undefined ? {} : { [key]: count(record, key, what) }
}

function optionalText(record: Fields, key: string, what: string) {
  return record[key] === undefined ? {} : { [key]: text(record, key, what) }
}

function member<T extends string>(
  record: Fields,
  key: string,
  values: readonly T[],
  what: string,
): T {
  const value = text(record, key, what)
  if (!(values as readonly string[]).includes(value))
    throw new Error(`${what}: "${key}" is "${value}"`)
  return value as T
}

const JOB_STATES: readonly SetupJobState[] = [
  "running",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]
const STEP_STATES: readonly SetupStepState[] = ["pending", "running", "done", "skipped", "failed"]

function targetSiteOf(record: Fields, what: string): TargetSite {
  if (record.kind === "this-machine") return { kind: "this-machine" }
  if (record.kind !== "ssh") throw new Error(`${what}: the site has an unknown kind`)
  return {
    kind: "ssh",
    host: text(record, "host", what),
    port: count(record, "port", what),
    user: text(record, "user", what),
    hostKey: text(record, "hostKey", what),
  }
}

function targetOf(record: Fields, what: string): SetupTarget {
  const consents = record.consents
  if (!Array.isArray(consents) || !consents.every((consent) => consent === "zabbly")) {
    throw new Error(`${what}: the consents are not a list of known consents`)
  }
  return {
    site: targetSiteOf(fields(record.site, what), what),
    project: parseProjectName(text(record, "project", what)),
    httpsPort: count(record, "httpsPort", what),
    consents: consents as "zabbly"[],
    identityAfter: member(record, "identityAfter", ["keep", "remove"], what),
  }
}

function siteViewOf(record: Fields, what: string): HostSiteView {
  if (record.kind === "this-machine") return { kind: "this-machine" }
  if (record.kind !== "ssh") throw new Error(`${what}: the site view has an unknown kind`)
  const hostKey = fields(record.hostKey, what)
  return {
    kind: "ssh",
    host: text(record, "host", what),
    port: count(record, "port", what),
    user: text(record, "user", what),
    hostKey: { type: text(hostKey, "type", what), fingerprint: text(hostKey, "fingerprint", what) },
    identity: member(record, "identity", ["kept", "removed"], what),
  }
}

function stepsOf(value: unknown, what: string): readonly SetupStepView[] {
  if (!Array.isArray(value) || value.length !== SETUP_STEPS.length) {
    throw new Error(`${what}: the steps are not the five setup steps`)
  }
  return value.map((entry, index) => {
    const step = fields(entry, what)
    if (step.id !== SETUP_STEPS[index]) throw new Error(`${what}: the steps are out of order`)
    return {
      id: SETUP_STEPS[index] as SetupStepView["id"],
      state: member(step, "state", STEP_STATES, what),
      ...optionalText(step, "note", what),
      ...optionalCount(step, "startedAt", what),
      ...optionalCount(step, "endedAt", what),
    }
  })
}

function failureOf(value: unknown, what: string): SetupFailure {
  const record = fields(value, what)
  const logTail = record.logTail
  if (!Array.isArray(logTail) || !logTail.every((line) => typeof line === "string")) {
    throw new Error(`${what}: the failure's log tail is not text`)
  }
  return {
    step: member(record, "step", SETUP_STEPS, what),
    code: member(record, "code", SETUP_FAILURE_CODES, what),
    what: text(record, "what", what),
    fix: text(record, "fix", what),
    ...optionalText(record, "command", what),
    ...optionalText(record, "location", what),
    ...optionalCount(record, "exitCode", what),
    logTail: logTail as string[],
  }
}

function factsOf(value: unknown, what: string): SetupFacts {
  const record = fields(value, what)
  const facts: Record<string, string> = {}
  for (const [key, fact] of Object.entries(record)) {
    if (!(HOST_SETUP_FACT_KEYS as readonly string[]).includes(key) || typeof fact !== "string") {
      throw new Error(`${what}: the fact "${key}" is unknown`)
    }
    facts[key] = fact
  }
  return facts
}

function hostRunOf(value: unknown, what: string): HostRun {
  const record = fields(value, what)
  const done = record.done
  if (
    !Array.isArray(done) ||
    !done.every((phase) => (ROOT_PHASES as readonly unknown[]).includes(phase))
  ) {
    throw new Error(`${what}: the finished phases are unknown`)
  }
  const flag = (key: string) => {
    if (typeof record[key] !== "boolean") throw new Error(`${what}: "${key}" is not true or false`)
    return record[key] as boolean
  }
  return {
    hello: flag("hello"),
    ...(record.phase === undefined ? {} : { phase: member(record, "phase", ROOT_PHASES, what) }),
    done: done as RootPhase[],
    token: flag("token"),
    ended: flag("ended"),
  }
}

export function jobOfRecord(text_: string, what: string): StoredJob {
  let value: unknown
  try {
    value = JSON.parse(text_)
  } catch {
    throw new Error(`${what} is not JSON`)
  }
  const record = fields(value, what)
  if (record.version !== JOB_VERSION) throw new Error(`${what} has an unknown version`)
  const id = text(record, "id", what)
  if (!JOB_ID.test(id)) throw new Error(`${what}: the id is malformed`)
  if (typeof record.dismissed !== "boolean")
    throw new Error(`${what}: "dismissed" is not true or false`)
  const job: SetupJob = {
    id,
    attempt: count(record, "attempt", what),
    site: siteViewOf(fields(record.site, what), what),
    target: targetOf(fields(record.target, what), what),
    state: member(record, "state", JOB_STATES, what),
    steps: stepsOf(record.steps, what),
    startedAt: count(record, "startedAt", what),
    ...optionalCount(record, "endedAt", what),
    ...(record.failure === undefined ? {} : { failure: failureOf(record.failure, what) }),
    facts: factsOf(record.facts, what),
    host: hostRunOf(record.host, what),
    dismissed: record.dismissed,
  }
  return { job, lines: count(fields(record.log, what), "lines", what) }
}

export function jobRecordText(job: SetupJob, lines: number): string {
  return `${JSON.stringify({ version: JOB_VERSION, ...job, log: { lines } }, null, 2)}\n`
}

const LOG_LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z) (host|plugin): (.*)$/

export function logLineText(line: SetupLogLine): string {
  return `${new Date(line.at).toISOString()} ${line.source}: ${line.text.replaceAll("\n", " ")}`
}

export function logLineOf(text_: string): SetupLogLine | undefined {
  const match = LOG_LINE.exec(text_)
  if (match === null) return undefined
  const [, at, source, body] = match
  return {
    at: Date.parse(at as string),
    source: source as SetupLogLine["source"],
    text: body as string,
  }
}

export function fileSetupJobStore(
  root: string,
  files: SetupFiles,
  log: (message: string) => void,
): SetupJobStore {
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work)
    queue = next.catch(() => {})
    return next
  }
  const dir = (jobId: string) => {
    if (!JOB_ID.test(jobId)) throw new Error(`"${jobId}" is not a setup job id`)
    return `${root}/${jobId}`
  }
  const ensureDir = async (jobId: string) => {
    await files.mkdir(root, 0o700)
    await files.mkdir(dir(jobId), 0o700)
  }

  return {
    dir,
    async load() {
      const found: StoredJob[] = []
      for (const name of await files.list(root)) {
        if (!JOB_ID.test(name)) continue
        const path = `${root}/${name}/${JOB_FILE}`
        const content = await files.read(path)
        if (content === undefined) continue
        try {
          const stored = jobOfRecord(content, path)
          if (stored.job.id !== name) throw new Error(`${path} names another job`)
          found.push(stored)
        } catch (error) {
          log(`the setup job ${path} is unreadable and is not shown: ${String(error)}`)
        }
      }
      return found.sort((a, b) => a.job.startedAt - b.job.startedAt)
    },
    save: (job, lines) =>
      serial(async () => {
        await ensureDir(job.id)
        await files.write(`${dir(job.id)}/${JOB_FILE}`, jobRecordText(job, lines), 0o600)
      }),
    append: (jobId, lines) =>
      serial(async () => {
        if (lines.length === 0) return
        await ensureDir(jobId)
        const content = lines.map((line) => `${logLineText(line)}\n`).join("")
        await files.append(`${dir(jobId)}/${LOG_FILE}`, content, 0o600, LOG_CAP_BYTES)
      }),
    async tail(jobId, wanted) {
      const content = await files.read(`${dir(jobId)}/${LOG_FILE}`)
      if (content === undefined) return []
      return content
        .split("\n")
        .slice(-wanted - 1)
        .flatMap((line) => {
          const parsed = logLineOf(line)
          return parsed === undefined ? [] : [parsed]
        })
        .slice(-wanted)
    },
    attach: (jobId, attached) =>
      serial(async () => {
        await ensureDir(jobId)
        for (const file of attached) {
          if (!ATTACHED_PATH.test(file.path) || RESERVED.has(file.path)) {
            throw new Error(`"${file.path}" cannot be attached to a setup job`)
          }
          const parts = file.path.split("/")
          for (let depth = 1; depth < parts.length; depth++) {
            await files.mkdir(`${dir(jobId)}/${parts.slice(0, depth).join("/")}`, 0o700)
          }
          await files.write(`${dir(jobId)}/${file.path}`, file.content, file.mode)
        }
      }),
    remove: (jobId) => serial(() => files.remove(dir(jobId))),
  }
}
