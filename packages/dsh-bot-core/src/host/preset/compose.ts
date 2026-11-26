import { createHash } from "node:crypto"
import type { BotOverlay, BotTemplate, OverlayOp, PluginRow } from "../../shared/preset"
import { BOT_PRESET_DESCRIPTION_PREFIX, botPresetId } from "../../shared/preset"
import { WEB_PROVIDER_ID } from "../../shared/web"
import type {
  BotPresetInput,
  BotPresetResult,
  ComposedPreset,
  CompositionInput,
  EnvironmentLayer,
  PresetHead,
  RowsComposition,
  RowsResult,
  WebComposition,
} from "./types"

export const BOT_PRESET_ORDER = 1000

const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function quote(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value)
}

export const GROUP_PLUGIN = "cordis:group"

export function nestedRowsOf(row: unknown): readonly unknown[] | undefined {
  if (!isRecord(row)) return undefined
  if (row.group !== true && row.name !== GROUP_PLUGIN) return undefined
  return Array.isArray(row.config) ? row.config : []
}

export function rowListProblem(
  rows: unknown,
  at = "",
  seen: Map<string, string> = new Map(),
): string | undefined {
  if (!Array.isArray(rows)) {
    return at === ""
      ? "plugins must be a list of plugin rows"
      : `group ${at} must hold a list of plugin rows in "config"`
  }
  for (const [index, row] of rows.entries()) {
    const label = at === "" ? `row ${index + 1}` : `${at} row ${index + 1}`
    if (!isRecord(row)) return `${label} is not a plugin row (expected a map with a "name")`
    const { id, name, group, config } = row
    if (typeof id !== "string" || id === "") {
      return `${label} has no id (a non-empty "id" string is required)`
    }
    const where = `${label} ("${id}")`
    if (typeof name !== "string" || name === "") {
      return `${where} names no plugin (a "name" string is required)`
    }
    const first = seen.get(id)
    if (first !== undefined) return `${where} repeats the id of ${first}`
    seen.set(id, label)
    if (name === GROUP_PLUGIN && group !== true) {
      return `${where} is a "${GROUP_PLUGIN}" row without "group: true"`
    }
    if (group === true && name !== GROUP_PLUGIN) {
      return `${where} sets "group: true" on ${quote(name)}; only "${GROUP_PLUGIN}" rows may be groups`
    }
    if (group === true) {
      const nested = rowListProblem(config, label, seen)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

export function templateProblem(template: unknown): string | undefined {
  if (!isRecord(template)) return "the template is not a map"
  const { id, name, description, plugins, hostTools } = template
  if (typeof id !== "string" || !TEMPLATE_ID.test(id)) {
    return `template id ${quote(id)} must be lowercase letters, digits and hyphens`
  }
  if (name !== undefined && typeof name !== "string")
    return `template "${id}": name must be a string`
  if (description !== undefined && typeof description !== "string") {
    return `template "${id}": description must be a string`
  }
  const rows = rowListProblem(plugins)
  if (rows !== undefined) return `template "${id}": ${rows}`
  if (hostTools !== undefined) {
    if (!Array.isArray(hostTools)) return `template "${id}": hostTools must be a list of tool names`
    for (const [index, tool] of hostTools.entries()) {
      if (typeof tool !== "string" || tool === "") {
        return `template "${id}": hostTools entry ${index + 1} is not a tool name`
      }
    }
  }
  return undefined
}

export function pluginNamesOf(
  rows: readonly unknown[],
  into: Set<string> = new Set(),
): Set<string> {
  for (const row of rows) {
    if (!isRecord(row)) continue
    if (typeof row.name === "string") into.add(row.name)
    const nested = nestedRowsOf(row)
    if (nested !== undefined) pluginNamesOf(nested, into)
  }
  return into
}

const LOADING_PLUGINS = [
  "cordis:include",
  "@deepseek-ai/cordis-plugin-include",
  "@deepseek-ai/cordis-plugin-loader",
]

export function pluginNameProblem(name: string, allowed: ReadonlySet<string>): string | undefined {
  if (name === GROUP_PLUGIN) return undefined
  const lower = name.toLowerCase()
  if (
    name.startsWith("/") ||
    name.startsWith(".") ||
    name.startsWith("\\") ||
    /^[a-z]:[\\/]/i.test(name) ||
    name.includes(":")
  ) {
    return `plugin ${quote(name)} is a path or URL; only package names are accepted`
  }
  if (LOADING_PLUGINS.some((loader) => lower === loader || lower.startsWith(`${loader}/`))) {
    return `plugin ${quote(name)} loads other entries and is not accepted in an overlay`
  }
  if (!allowed.has(name)) {
    return `plugin ${quote(name)} is not allowed: use a plugin of a registered template, or allow it in the bot-core config (allowedPlugins)`
  }
  return undefined
}

const HOST_PATH_CONFIG: Readonly<Record<string, readonly string[]>> = {
  "@deepseek-ai/dsh-agent-instructions": ["dshHome", "agentsHome"],
}

function hostPathConfigProblem(row: Record<string, unknown>): string | undefined {
  if (typeof row.name !== "string" || !isRecord(row.config)) return undefined
  const keys = HOST_PATH_CONFIG[packageOf(row.name)] ?? []
  const key = keys.find((name) => (row.config as Record<string, unknown>)[name] !== undefined)
  return key === undefined
    ? undefined
    : `config "${key}" of ${quote(row.name)} points at Host paths and is not accepted in an overlay; declare it in a template`
}

export function overlayPluginProblem(
  overlay: readonly unknown[],
  allowed: ReadonlySet<string>,
): string | undefined {
  const check = (rows: readonly unknown[], at: string): string | undefined => {
    for (const [index, row] of rows.entries()) {
      if (!isRecord(row)) continue
      const where = at === "" ? `row` : `${at} row ${index + 1}`
      if (typeof row.name === "string") {
        const problem = pluginNameProblem(row.name, allowed) ?? hostPathConfigProblem(row)
        if (problem !== undefined) return `${where} ${quote(row.id)}: ${problem}`
      }
      const children = nestedRowsOf(row)
      if (children !== undefined) {
        const nested = check(children, where)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }
  for (const [index, op] of overlay.entries()) {
    if (!isRecord(op) || !isRecord(op.row)) continue
    const problem = check([op.row], "")
    if (problem !== undefined) return `${describeOp(op, index)}: ${problem}`
  }
  return undefined
}

export const ENVIRONMENT_GROUP_ID = "bot-environment"

export const ENVIRONMENT_ROW_PREFIX = "env-"

export const ENVIRONMENT_SERVICES: readonly string[] = [
  "ssh",
  "fs",
  "subprocess",
  "shell",
  "sandbox",
  "sandboxPolicy",
  "terminals",
  "webTerminals",
  "ptcRuntime",
  "workflowEngine",
  "worktrees",
  "officeKit",
  "computerUse",
  "cuaAccess",
  "web",
  "skills",
]

const HOST_EXECUTION_PACKAGES = new Set([
  "@deepseek-ai/dsh-fs-local",
  "@deepseek-ai/dsh-fs-sandbox",
  "@deepseek-ai/dsh-subprocess-local",
  "@deepseek-ai/dsh-sandbox-local",
  "@deepseek-ai/dsh-bash-sandbox",
  "@deepseek-ai/dsh-bash-local",
  "@deepseek-ai/dsh-ssh",
  "@deepseek-ai/dsh-fs-ssh",
  "@deepseek-ai/dsh-subprocess-ssh",
  "@deepseek-ai/dsh-sandbox-ssh",
  "@deepseek-ai/dsh-sandbox-policy",
  "@deepseek-ai/dsh-ptc-runtime-node",
  "@deepseek-ai/dsh-tool-executor-ptc",
  "@deepseek-ai/dsh-workflow-ptc",
  "@deepseek-ai/dsh-tool-workflow",
  "@deepseek-ai/dsh-tool-office",
  "@deepseek-ai/dsh-office-kit",
  "@deepseek-ai/dsh-tool-working-directory",
  "@deepseek-ai/dsh-working-directory",
  "@deepseek-ai/dsh-tool-terminal",
  "@deepseek-ai/dsh-tool-bash-persistent",
  "@deepseek-ai/dsh-mcp-client",
  "@deepseek-ai/dsh-mcp-manager",
  "@deepseek-ai/dsh-tool-cordis",
  "@deepseek-ai/dsh-tool-session-query",
  "@deepseek-ai/dsh-tool-schedule",
  "@deepseek-ai/dsh-schedule",
  "@deepseek-ai/dsh-tool-workspace-dependencies",
  "@deepseek-ai/dsh-host-open-in-app",
  "@deepseek-ai/dsh-creation-recommendations",
  "@deepseek-ai/dsh-experimental-liveshare",
  "@deepseek-ai/dsh-native-command",
  "@1outres/dsh-bot-vm",
])

const HOST_EXECUTION_PREFIXES = [
  "@deepseek-ai/dsh-pwsh-",
  "@deepseek-ai/dsh-tool-pwsh",
  "@deepseek-ai/dsh-terminal",
  "@deepseek-ai/dsh-plugin-manager",
  "@deepseek-ai/dsh-cua",
  "@deepseek-ai/dsh-computer-use",
]

const WEB_SEAM_PACKAGES = new Set([
  "@deepseek-ai/dsh-web",
  "@deepseek-ai/dsh-web-fetch-http",
  "@deepseek-ai/dsh-web-deepseek-api",
  "@deepseek-ai/dsh-web-search-deepseek",
  "@1outres/dsh-plugin-exa",
  "@1outres/dsh-bot-web",
])

const SKILL_SEAM_PACKAGES = new Set([
  "@deepseek-ai/dsh-skill",
  "@deepseek-ai/dsh-skill-filesystem",
  "@deepseek-ai/dsh-skill-office",
])

const ROW_CARRIER_PACKAGES = new Set([
  "@deepseek-ai/cordis-plugin-group",
  "@deepseek-ai/cordis-plugin-include",
  "@deepseek-ai/cordis-plugin-loader",
  "@deepseek-ai/dsh-agent-preset",
  "@1outres/dsh-bot-core",
])

function packageOf(name: string): string {
  const parts = name.toLowerCase().split("/")
  return parts[0]?.startsWith("@") === true ? parts.slice(0, 2).join("/") : (parts[0] ?? "")
}

export function isHostExecutionPlugin(name: string): boolean {
  const pkg = packageOf(name)
  return (
    HOST_EXECUTION_PACKAGES.has(pkg) ||
    HOST_EXECUTION_PREFIXES.some((prefix) => pkg.startsWith(prefix)) ||
    (pkg.startsWith("@deepseek-ai/dsh-experimental-") && pkg.includes("worktree"))
  )
}

function compositionPluginProblem(name: string): string | undefined {
  if (name === GROUP_PLUGIN) return undefined
  if (packageOf(name) === PRESENT_ROW_PLUGIN) {
    return `names ${quote(name)}, which bot-core puts in every bot's preset itself (row "${PRESENT_ROW_ID}")`
  }
  if (
    name.startsWith("/") ||
    name.startsWith(".") ||
    name.startsWith("\\") ||
    /^[a-z]:[\\/]/i.test(name) ||
    name.includes(":")
  ) {
    return `names ${quote(name)}, a path, URL or Loader builtin; only package names and "${GROUP_PLUGIN}" are accepted`
  }
  if (ROW_CARRIER_PACKAGES.has(packageOf(name))) {
    return `names ${quote(name)}, which carries rows outside bot-core's checks; nest rows with "${GROUP_PLUGIN}"`
  }
  if (isHostExecutionPlugin(name)) {
    return `names ${quote(name)}, which runs on the Host outside the bot's environment`
  }
  if (WEB_SEAM_PACKAGES.has(packageOf(name))) {
    return `names ${quote(name)}, which provides the bot's web seam outside bot-core's settings`
  }
  if (SKILL_SEAM_PACKAGES.has(packageOf(name))) {
    return `names ${quote(name)}, which provides skills; a bot's skills are skills/ in its workspace (bot-core's row "${SKILLS_ROW_ID}")`
  }
  return undefined
}

export function environmentEscapeProblem(
  rows: readonly unknown[],
  isolated: ReadonlySet<string>,
  at = "",
): string | undefined {
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) continue
    const label = at === "" ? `row ${index + 1}` : `${at} row ${index + 1}`
    const where = `${label} (${quote(row.id)})`
    if (
      typeof row.id === "string" &&
      (row.id === ENVIRONMENT_GROUP_ID || row.id.startsWith(ENVIRONMENT_ROW_PREFIX))
    ) {
      return `${where} uses a row id reserved for the bot's environment ("${ENVIRONMENT_GROUP_ID}", "${ENVIRONMENT_ROW_PREFIX}…")`
    }
    if (typeof row.name === "string") {
      const problem = compositionPluginProblem(row.name)
      if (problem !== undefined) return `${where} ${problem}`
    }
    if (row.isolate !== undefined && row.isolate !== null) {
      if (!isRecord(row.isolate)) return `${where} has an "isolate" that is not a map`
      for (const [service, value] of Object.entries(row.isolate)) {
        if (isolated.has(service)) {
          return `${where} isolates "${service}", which the bot's environment provides`
        }
        if (value !== true) {
          return `${where} isolates "${service}" with ${quote(value)}; only true is accepted`
        }
      }
    }
    if (row.intercept !== undefined && row.intercept !== null) {
      if (!isRecord(row.intercept)) return `${where} has an "intercept" that is not a map`
      const service = Object.keys(row.intercept).find((name) => isolated.has(name))
      if (service !== undefined) {
        return `${where} intercepts "${service}", which the bot's environment provides`
      }
    }
    const nested = nestedRowsOf(row)
    if (nested !== undefined) {
      const problem = environmentEscapeProblem(nested, isolated, label)
      if (problem !== undefined) return problem
    }
  }
  return undefined
}

function rowIdsOf(rows: readonly unknown[], into: string[] = []): string[] {
  for (const row of rows) {
    if (!isRecord(row)) continue
    into.push(typeof row.id === "string" ? row.id : "")
    const nested = nestedRowsOf(row)
    if (nested !== undefined) rowIdsOf(nested, into)
  }
  return into
}

function rowNamesOf(rows: readonly unknown[], into = new Set<string>()): Set<string> {
  for (const row of rows) {
    if (!isRecord(row)) continue
    if (typeof row.name === "string") into.add(row.name)
    const nested = nestedRowsOf(row)
    if (nested !== undefined) rowNamesOf(nested, into)
  }
  return into
}

function environmentLayerProblem(layer: EnvironmentLayer): string | undefined {
  if (typeof layer.id !== "string" || layer.id === "") return "the environment has no id"
  const what = `the environment "${layer.id}"`
  if (
    !Array.isArray(layer.isolate) ||
    layer.isolate.some((name) => typeof name !== "string" || name === "")
  ) {
    return `${what} must isolate a list of service names`
  }
  const rows = rowListProblem(layer.rows)
  if (rows !== undefined) return `${what}: ${rows}`
  const ids = rowIdsOf(layer.rows)
  const names = rowNamesOf(layer.rows)
  for (const own of [...BOT_CORE_ROWS, WEB_ROW, SKILL_ROW, PRESENT_ROW, COMPACTION_ROW]) {
    if (ids.includes(own.id) || names.has(own.plugin)) {
      return `${what}: its rows may not use bot-core's own row ("${own.id}", "${own.plugin}")`
    }
  }
  const foreign = rowIdsOf(layer.rows).find((id) => !id.startsWith(ENVIRONMENT_ROW_PREFIX))
  if (foreign !== undefined) {
    return `${what}: row id ${quote(foreign)} does not start with "${ENVIRONMENT_ROW_PREFIX}"`
  }
  return undefined
}

export const FILES_ROW_ID = "env-bot-core-files"

export const FILES_ROW_PLUGIN = "@1outres/dsh-bot-core/files"

export const CHANNEL_ROW_ID = "env-bot-core-channel"

export const CHANNEL_ROW_PLUGIN = "@1outres/dsh-bot-core/channel"

export const CONNECTORS_ROW_ID = "env-bot-core-connectors"

export const CONNECTORS_ROW_PLUGIN = "@1outres/dsh-bot-core/connectors"

export const VAULTS_ROW_ID = "env-bot-core-vaults"

export const VAULTS_ROW_PLUGIN = "@1outres/dsh-bot-core/vaults"

export const VAULT_GUARD_ROW_ID = "env-bot-core-vault-guard"

export const VAULT_GUARD_ROW_PLUGIN = "@1outres/dsh-bot-core/vault-guard"

export const SCHEDULE_ROW_ID = "env-bot-core-schedule"

export const SCHEDULE_ROW_PLUGIN = "@1outres/dsh-bot-core/schedule"

export const SESSIONS_ROW_ID = "env-bot-core-sessions"

export const SESSIONS_ROW_PLUGIN = "@1outres/dsh-bot-core/sessions"

export const PEERS_ROW_ID = "env-bot-core-peers"

export const PEERS_ROW_PLUGIN = "@1outres/dsh-bot-core/peers"

export const PROMPT_ROW_ID = "env-bot-core-prompt"

export const PROMPT_ROW_PLUGIN = "@1outres/dsh-bot-core/prompt"

export const NOTES_ROW_ID = "env-bot-core-notes"

export const NOTES_ROW_PLUGIN = "@1outres/dsh-bot-core/notes"

export const SKILLS_ROW_ID = "env-bot-core-skills"

export const SKILLS_ROW_PLUGIN = "@1outres/dsh-bot-core/skills"

export const CONVERSATIONS_ROW_ID = "env-bot-core-conversations"

export const CONVERSATIONS_ROW_PLUGIN = "@1outres/dsh-bot-core/conversations"

export const SETTINGS_ROW_ID = "env-bot-core-settings"

export const SETTINGS_ROW_PLUGIN = "@1outres/dsh-bot-core/settings"

export const SKILL_ROW_ID = "env-bot-core-skill"

export const SKILL_ROW_PLUGIN = "@deepseek-ai/dsh-skill"

const SKILL_ROW = { id: SKILL_ROW_ID, plugin: SKILL_ROW_PLUGIN } as const

export const WEB_ROW_ID = "env-bot-core-web"

export const WEB_ROW_PLUGIN = "@deepseek-ai/dsh-web"

export const WEB_BRIDGE_ROW_ID = "env-bot-core-web-bridge"

export const WEB_BRIDGE_ROW_PLUGIN = "@1outres/dsh-bot-core/web"

const WEB_ROW = { id: WEB_ROW_ID, plugin: WEB_ROW_PLUGIN } as const

export const COMPACTION_ROW_ID = "env-bot-core-compaction"

export const COMPACTION_ROW_PLUGIN = "@1outres/dsh-bot-core/compaction"

const COMPACTION_ROW = { id: COMPACTION_ROW_ID, plugin: COMPACTION_ROW_PLUGIN } as const

export const COMPACTION_SERVICE = "compaction"

export function compactionGroupsOf(
  rows: readonly unknown[],
  at: readonly number[] = [],
): number[][] {
  const found: number[][] = []
  for (const [index, row] of rows.entries()) {
    const nested = nestedRowsOf(row)
    if (nested === undefined || !isRecord(row)) continue
    const path = [...at, index]
    if (isRecord(row.isolate) && row.isolate[COMPACTION_SERVICE] === true) found.push(path)
    found.push(...compactionGroupsOf(nested, path))
  }
  return found
}

function withRowAt(
  rows: readonly PluginRow[],
  path: readonly number[],
  row: PluginRow,
): PluginRow[] {
  const [head, ...rest] = path
  if (head === undefined) return [...rows, row]
  return rows.map((existing, index) =>
    index === head
      ? { ...existing, config: withRowAt((nestedRowsOf(existing) ?? []) as PluginRow[], rest, row) }
      : existing,
  )
}
export const PRESENT_ROW_ID = "env-bot-core-present"

export const PRESENT_ROW_PLUGIN = "@deepseek-ai/dsh-tool-present"

export const PRESENT_TOOL = "present"

const PRESENT_ROW = { id: PRESENT_ROW_ID, plugin: PRESENT_ROW_PLUGIN } as const

const BOT_CORE_ROWS = [
  { id: FILES_ROW_ID, plugin: FILES_ROW_PLUGIN },
  { id: CHANNEL_ROW_ID, plugin: CHANNEL_ROW_PLUGIN },
  { id: CONNECTORS_ROW_ID, plugin: CONNECTORS_ROW_PLUGIN },
  { id: VAULTS_ROW_ID, plugin: VAULTS_ROW_PLUGIN },
  { id: VAULT_GUARD_ROW_ID, plugin: VAULT_GUARD_ROW_PLUGIN },
  { id: SCHEDULE_ROW_ID, plugin: SCHEDULE_ROW_PLUGIN },
  { id: SESSIONS_ROW_ID, plugin: SESSIONS_ROW_PLUGIN },
  { id: PEERS_ROW_ID, plugin: PEERS_ROW_PLUGIN },
  { id: PROMPT_ROW_ID, plugin: PROMPT_ROW_PLUGIN },
  { id: NOTES_ROW_ID, plugin: NOTES_ROW_PLUGIN },
  { id: SKILLS_ROW_ID, plugin: SKILLS_ROW_PLUGIN },
  { id: CONVERSATIONS_ROW_ID, plugin: CONVERSATIONS_ROW_PLUGIN },
  { id: SETTINGS_ROW_ID, plugin: SETTINGS_ROW_PLUGIN },
  { id: WEB_BRIDGE_ROW_ID, plugin: WEB_BRIDGE_ROW_PLUGIN },
] as const

export const BOT_CORE_ROW_IDS: readonly string[] = [
  ...BOT_CORE_ROWS.map((row) => row.id),
  WEB_ROW_ID,
  SKILL_ROW_ID,
  PRESENT_ROW_ID,
  COMPACTION_ROW_ID,
]

export const TOOL_WEB_PLUGIN = "@deepseek-ai/dsh-tool-web"

export function withWebCapabilities(rows: readonly PluginRow[], web: WebComposition): PluginRow[] {
  return rows.map((row) => {
    if (row.name === TOOL_WEB_PLUGIN) {
      const config = isRecord(row.config) ? row.config : {}
      return {
        ...row,
        config: {
          ...config,
          search: config.search !== false && web.search,
          fetch: config.fetch !== false && web.fetch,
        },
      }
    }
    const nested = nestedRowsOf(row) as readonly PluginRow[] | undefined
    if (nested === undefined) return row
    const rewritten = withWebCapabilities(nested, web)
    return rewritten.every((child, index) => child === nested[index])
      ? row
      : { ...row, config: rewritten }
  })
}

function environmentGroup(layer: EnvironmentLayer, members: readonly PluginRow[]): PluginRow {
  const isolate = new Set([...ENVIRONMENT_SERVICES, ...layer.isolate])
  return {
    id: ENVIRONMENT_GROUP_ID,
    name: GROUP_PLUGIN,
    group: true,
    isolate: Object.fromEntries([...isolate].sort().map((service) => [service, true])),
    config: members,
  }
}

const PRESET_SELECTORS = ["agentPreset", "allowedAgentPresets"] as const

export function foreignPresetProblem(
  rows: readonly unknown[],
  presetId: string,
  at = "",
): string | undefined {
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) continue
    const label = at === "" ? `row ${index + 1}` : `${at} row ${index + 1}`
    const children = nestedRowsOf(row)
    if (children !== undefined) {
      const nested = foreignPresetProblem(children, presetId, label)
      if (nested !== undefined) return nested
      continue
    }
    const { config } = row
    if (!isRecord(config)) continue
    for (const field of PRESET_SELECTORS) {
      const value = config[field]
      if (value === undefined) continue
      const named = Array.isArray(value) ? value : [value]
      const foreign = named.find((preset) => preset !== presetId)
      if (foreign !== undefined) {
        return `${label} ("${row.id}") lets subagents run Agent preset ${quote(foreign)} through "${field}"; a bot's subagents may only use the bot's own preset "${presetId}"`
      }
    }
  }
  return undefined
}

function describeOp(op: unknown, index: number): string {
  const n = `overlay op ${index + 1}`
  if (!isRecord(op)) return n
  const target = op.op === "add" ? (isRecord(op.row) ? op.row.id : undefined) : op.id
  return typeof op.op === "string" && typeof target === "string"
    ? `${n} (${op.op} "${target}")`
    : typeof op.op === "string"
      ? `${n} (${op.op})`
      : n
}

function locate(
  rows: readonly PluginRow[],
  id: string,
  role: string,
): { index: number } | { problem: string } {
  const index = rows.findIndex((row) => row.id === id)
  if (index >= 0) return { index }
  const nested = new Map<string, string>()
  rowListProblem(rows, "", nested)
  return nested.has(id)
    ? { problem: `${role} "${id}" is nested in a group; overlays address top-level rows only` }
    : { problem: `${role} "${id}" is not a top-level row` }
}

function rowOf(op: Record<string, unknown>): PluginRow | string {
  const { row } = op
  if (!isRecord(row)) return `"row" must be a plugin row map`
  if (typeof row.id !== "string" || row.id === "") return `its row has no id`
  return row as PluginRow
}

function applyOp(rows: readonly PluginRow[], op: OverlayOp | unknown): PluginRow[] | string {
  if (!isRecord(op)) return "is not an overlay op map"
  switch (op.op) {
    case "add": {
      const row = rowOf(op)
      if (typeof row === "string") return row
      if (rows.some((existing) => existing.id === row.id)) {
        return `row id "${row.id}" is already in use`
      }
      if (op.after === undefined) return [...rows, row]
      if (typeof op.after !== "string") return `"after" must be a row id`
      const at = locate(rows, op.after, "after")
      if ("problem" in at) return at.problem
      return [...rows.slice(0, at.index + 1), row, ...rows.slice(at.index + 1)]
    }
    case "replace": {
      if (typeof op.id !== "string" || op.id === "") return `"id" must be a row id`
      const row = rowOf(op)
      if (typeof row === "string") return row
      if (row.id !== op.id) return `its row id "${row.id}" differs from the replaced id "${op.id}"`
      const at = locate(rows, op.id, "row")
      if ("problem" in at) return at.problem
      return rows.map((existing, index) => (index === at.index ? row : existing))
    }
    case "remove": {
      if (typeof op.id !== "string" || op.id === "") return `"id" must be a row id`
      const at = locate(rows, op.id, "row")
      if ("problem" in at) return at.problem
      return rows.filter((_, index) => index !== at.index)
    }
    default:
      return `has unknown op ${quote(op.op)} (expected add, replace or remove)`
  }
}

export function applyOverlay(
  rows: readonly PluginRow[],
  overlay: BotOverlay,
): { ok: true; rows: readonly PluginRow[] } | { ok: false; problem: string } {
  if (!Array.isArray(overlay)) return { ok: false, problem: "the overlay must be a list of ops" }
  let current: readonly PluginRow[] = [...rows]
  for (const [index, op] of overlay.entries()) {
    const next = applyOp(current, op)
    if (typeof next === "string") return { ok: false, problem: `${describeOp(op, index)}: ${next}` }
    current = next
  }
  return { ok: true, rows: current }
}

const identities = new WeakMap<object, number>()
const symbols = new Map<symbol, number>()
let nextIdentity = 0

function identityOf(value: object | symbol): number {
  const known = typeof value === "symbol" ? symbols.get(value) : identities.get(value)
  if (known !== undefined) return known
  nextIdentity += 1
  if (typeof value === "symbol") symbols.set(value, nextIdentity)
  else identities.set(value, nextIdentity)
  return nextIdentity
}

function isPlain(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function canonical(value: unknown, ancestors: Set<object>): unknown {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value
    case "number":
      return Number.isFinite(value) ? value : { $number: String(value) }
    case "bigint":
      return { $bigint: value.toString() }
    case "undefined":
      return { $undefined: true }
    case "symbol": {
      const key = Symbol.keyFor(value)
      return key === undefined ? { $ref: identityOf(value) } : { $symbol: key }
    }
    case "function":
      return { $ref: identityOf(value) }
  }
  if (value === null) return null
  const object = value as object
  if (ancestors.has(object) || !(Array.isArray(object) || isPlain(object))) {
    return { $ref: identityOf(object) }
  }
  ancestors.add(object)
  try {
    if (Array.isArray(object)) return object.map((item) => canonical(item, ancestors))
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(object).sort()) {
      const field = (object as Record<string, unknown>)[key]
      if (field === undefined) continue
      out[`.${key}`] = canonical(field, ancestors)
    }
    return out
  } finally {
    ancestors.delete(object)
  }
}

export function presetDigest(preset: ComposedPreset, hostTools: readonly string[]): string {
  const mounted = { id: preset.id, plugins: preset.plugins }
  const text = JSON.stringify(canonical({ preset: mounted, hostTools }, new Set()))
  return createHash("sha256").update(text).digest("hex")
}

function presetHead(botId: string, botName: string, template: BotTemplate): PresetHead {
  const templateName =
    template.name === undefined || template.name === "" ? template.id : template.name
  return {
    id: botPresetId(botId),
    name: `Bot: ${botName}`,
    description: `${BOT_PRESET_DESCRIPTION_PREFIX}"${botName}", composed from template "${templateName}" (${template.id}).`,
    order: BOT_PRESET_ORDER,
  }
}

function revisionOf(composition: RowsComposition, layer: EnvironmentLayer): string {
  const plugins = [environmentGroup(layer, [...layer.rows, ...composition.rows])]
  return presetDigest({ ...composition.head, plugins }, composition.hostTools)
}

function withBotCoreRows(
  composition: RowsComposition,
  layer: EnvironmentLayer,
  botId: string,
  revisionToken: string,
  web: WebComposition,
): ComposedPreset {
  const sealed = { botId, token: revisionToken }
  const own: PluginRow[] = BOT_CORE_ROWS.map((row) => ({
    id: row.id,
    name: row.plugin,
    config: row.id === WEB_BRIDGE_ROW_ID ? { ...sealed, ...web } : sealed,
  }))
  const seam: PluginRow = {
    id: WEB_ROW_ID,
    name: WEB_ROW_PLUGIN,
    config: { searchProvider: WEB_PROVIDER_ID, fetchProvider: WEB_PROVIDER_ID },
  }
  const registry: PluginRow = { id: SKILL_ROW_ID, name: SKILL_ROW_PLUGIN }
  const present: PluginRow = { id: PRESENT_ROW_ID, name: PRESENT_ROW_PLUGIN }
  const seams: Readonly<Record<string, PluginRow>> = {
    [SKILLS_ROW_ID]: registry,
    [WEB_BRIDGE_ROW_ID]: seam,
  }
  const ordered = [
    ...own.flatMap((row) =>
      seams[row.id] === undefined ? [row] : [seams[row.id] as PluginRow, row],
    ),
    present,
  ]
  const compactor: PluginRow = {
    id: COMPACTION_ROW_ID,
    name: COMPACTION_ROW_PLUGIN,
    config: sealed,
  }
  const [group] = compactionGroupsOf(composition.rows)
  const members =
    group === undefined
      ? [...layer.rows, ...ordered, compactor, ...composition.rows]
      : [...layer.rows, ...ordered, ...withRowAt(composition.rows, group, compactor)]
  const plugins = [environmentGroup(layer, members)]
  return { ...composition.head, plugins }
}

function composeIsolated(input: CompositionInput, isolated: ReadonlySet<string>): RowsResult {
  const { botId, botName, template, overlay, allowedHostTools, web } = input
  if (typeof botId !== "string" || botId === "")
    return { ok: false, problem: "the bot id is empty" }
  const invalid = templateProblem(template)
  if (invalid !== undefined) return { ok: false, problem: invalid }
  const applied = applyOverlay(template.plugins, overlay)
  if (!applied.ok) return { ok: false, problem: `template "${template.id}": ${applied.problem}` }
  const composed =
    rowListProblem(applied.rows) ??
    environmentEscapeProblem(applied.rows, isolated) ??
    foreignPresetProblem(applied.rows, botPresetId(botId))
  if (composed !== undefined) {
    return { ok: false, problem: `template "${template.id}" with the overlay: ${composed}` }
  }
  if (compactionGroupsOf(applied.rows).length > 1) {
    return {
      ok: false,
      problem: `template "${template.id}" with the overlay: more than one group isolates "${COMPACTION_SERVICE}"; a bot has one compaction backend`,
    }
  }
  const hostTools = [...new Set(template.hostTools ?? [])].sort()
  if (hostTools.includes(PRESENT_TOOL)) {
    return {
      ok: false,
      problem: `template "${template.id}" lets bots use Host tool "${PRESENT_TOOL}", which reads Host paths; every bot has its own present (row "${PRESENT_ROW_ID}")`,
    }
  }
  const unlisted = hostTools.find((tool) => !allowedHostTools.has(tool))
  if (unlisted !== undefined) {
    return {
      ok: false,
      problem: `template "${template.id}" lets bots use Host tool "${unlisted}", which the bot-core config does not allow (allowedHostTools)`,
    }
  }
  return {
    ok: true,
    head: presetHead(botId, botName, template),
    rows: withWebCapabilities(applied.rows, web),
    hostTools,
  }
}

export function composeRows(input: CompositionInput): RowsResult {
  return composeIsolated(input, new Set(ENVIRONMENT_SERVICES))
}

export function composeBotPreset(input: BotPresetInput): BotPresetResult {
  const { botId, environment, seal } = input
  const layer = environmentLayerProblem(environment)
  if (layer !== undefined) return { ok: false, problem: layer }
  const composed = composeIsolated(
    input,
    new Set([...ENVIRONMENT_SERVICES, ...environment.isolate]),
  )
  if (!composed.ok) return composed
  const wrapped = rowListProblem([
    environmentGroup(environment, [...environment.rows, ...composed.rows]),
  ])
  if (wrapped !== undefined) {
    return { ok: false, problem: `the environment "${environment.id}" with the preset: ${wrapped}` }
  }
  const foreign = foreignPresetProblem(environment.rows, composed.head.id)
  if (foreign !== undefined) {
    return { ok: false, problem: `the environment "${environment.id}": ${foreign}` }
  }
  const revisionToken = seal(revisionOf(composed, environment))
  const preset = withBotCoreRows(composed, environment, botId, revisionToken, input.web)
  return {
    ok: true,
    preset,
    hostTools: composed.hostTools,
    digest: presetDigest(preset, composed.hostTools),
    revisionToken,
  }
}
