import type { BotConnectorRun } from "../../connector-contract"
import type { ConnectorJson } from "../../shared/connectors"
import type { CatalogTool } from "./catalog"
import type { ImageRef } from "./images"
import type { PreparedRun } from "./runs"

/** A tool's result as bot-core keeps it: bounded text and data, stored image references. */
export interface ToolOutput {
  readonly text?: string
  /** `null` when the tool returned none. */
  readonly data: ConnectorJson
  readonly images: readonly ImageRef[]
}

export type ExecutionOutcome =
  | { readonly ok: true; readonly output: ToolOutput }
  | { readonly ok: false; readonly reason: string }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function isJson(value: unknown, depth = 0): value is ConnectorJson {
  if (depth > 64) return false
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1))
  if (typeof value !== "object") return false
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return false
  return Object.values(value).every((item) => isJson(item, depth + 1))
}

function boundedData(data: ConnectorJson, max: number): ConnectorJson {
  const text = JSON.stringify(data)
  return text.length <= max ? data : { truncated: true, json: text.slice(0, max) }
}

function boundedText(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n[… cut: ${text.length - max} more characters]`
}

function outputOf(entry: CatalogTool, result: unknown, prepared: PreparedRun): ToolOutput | string {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return "the tool returned something that is not a result object"
  }
  const { text, data, images, ...rest } = result as Record<string, unknown>
  if (Object.keys(rest).length > 0)
    return `the tool's result has unknown fields: ${Object.keys(rest).join(", ")}`
  if (text !== undefined && typeof text !== "string") return "the tool's result text is not text"
  if (data !== undefined && !isJson(data)) return "the tool's result data is not JSON"
  if (images !== undefined && !Array.isArray(images))
    return "the tool's result images are not a list"
  let refs: readonly ImageRef[] = []
  if (images !== undefined && images.length > 0) {
    if (prepared.images === undefined) return "only a call's result can carry images"
    try {
      refs = prepared.images.refs(images)
    } catch (error) {
      return messageOf(error)
    }
  }
  return {
    ...(text === undefined ? {} : { text: boundedText(text, entry.maxResultChars) }),
    data: data === undefined ? null : boundedData(data, entry.maxResultChars),
    images: refs,
  }
}

/**
 * Run one connector tool: the arguments are checked against its schema
 * again, an approved action passes the tool's recheck first, and the result
 * must be a result object. With {@link takeSnapshot}, the only place a
 * connector tool's hooks run (design rule 39).
 */
export async function runConnectorTool(
  entry: CatalogTool,
  args: ConnectorJson,
  prepared: PreparedRun,
): Promise<ExecutionOutcome> {
  const problems = entry.check(args)
  if (problems.length > 0) return { ok: false, reason: `invalid arguments: ${problems.join("; ")}` }
  const { run } = prepared
  const typed = entry.split(args).own as never
  const tool = entry.tool
  try {
    if (run.trigger.kind === "approval" && tool.recheck !== undefined) {
      const verdict: unknown = await tool.recheck(typed, run)
      const { proceed, reason } = verdict as { proceed?: unknown; reason?: unknown }
      if (proceed !== true) {
        return {
          ok: false,
          reason: typeof reason === "string" ? reason : "the tool's recheck refused it",
        }
      }
    }
    const result: unknown = await tool.execute(typed, run)
    const output = outputOf(entry, result, prepared)
    return typeof output === "string" ? { ok: false, reason: output } : { ok: true, output }
  } catch (error) {
    return { ok: false, reason: messageOf(error) }
  }
}

/** Read what the tool's preview needs beyond the arguments, when it has a `snapshot` hook. */
export async function takeSnapshot(
  entry: CatalogTool,
  args: ConnectorJson,
  run: BotConnectorRun<unknown>,
): Promise<ConnectorJson | undefined> {
  const tool = entry.tool
  if (tool.snapshot === undefined) return undefined
  const snapshot: unknown = await tool.snapshot(entry.split(args).own as never, run)
  if (!isJson(snapshot)) throw new Error("its snapshot is not JSON")
  const text = JSON.stringify(snapshot)
  if (text.length > entry.maxResultChars) {
    throw new Error(`its snapshot is longer than ${entry.maxResultChars} characters`)
  }
  return snapshot
}
