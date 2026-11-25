import { type JsonSchemaNode, validateJsonSchemaValue } from "@deepseek-ai/dsh-tools"
import {
  type BotConnector,
  type BotConnectorToolDefinition,
  DEFAULT_ASK_TTL_MS,
  DEFAULT_ASK_WAIT_MS,
  DEFAULT_RESULT_CHARS,
  MAX_ASK_TTL_MS,
  MAX_ASK_WAIT_MS,
  MAX_RESULT_CHARS,
} from "../../connector-contract"
import {
  BOT_CREATION_OPTIONS,
  CONNECTOR_PANEL_ICONS,
  CONNECTOR_PERMISSIONS,
  CONNECTOR_SESSIONS,
  type ConnectorJson,
  connectorSettingsProblem,
  connectorToolName,
  isBotCreationOption,
  isConnectorPanelIcon,
} from "../../shared/connectors"
import { BOT_ENVIRONMENT_SPEC_KEYS } from "../../shared/environment"
import { type ArgumentsCheck, compileArguments } from "./arguments"
import { closesRequirementCycle } from "./requirements"

const ID = /^[a-z][a-z0-9_]*$/
/** bot-core's own tools are named connector_*. */
const RESERVED_ID = "connector"
/** Model APIs take tool names of at most 64 characters. */
const MAX_TOOL_NAME = 64
const EXCLUSIVE = /^[a-z][a-z0-9_-]*$/

/** A registered connector, its resident resource type erased. */
export type CatalogConnector = BotConnector<unknown>

/** A tool of a registered connector, with what bot-core derived from it. */
export interface CatalogTool {
  readonly connector: CatalogConnector
  readonly tool: BotConnectorToolDefinition<unknown>
  /** Its name among the bot's tools. */
  readonly name: string
  readonly waitMs: number
  readonly ttlMs: number
  readonly maxResultChars: number
  /** Its arguments' JSON Schema, as the model sees it (with `account` for a connector with connections). */
  readonly schema: JsonSchemaNode
  /** Checks a call's arguments against {@link schema}. */
  readonly check: ArgumentsCheck
  /** A checked call's arguments split into the account it names and the tool's own arguments. */
  split(args: ConnectorJson): CallArguments
}

/** A call's arguments as bot-core hands them on. */
export interface CallArguments {
  /** The account a call of a connector with connections names. */
  readonly account?: string
  /** What the tool's hooks get. */
  readonly own: ConnectorJson
}

/** The argument bot-core adds to every tool of a connector with connections. */
export const ACCOUNT_ARGUMENT = "account"

/** bot-core's own tools of a connector with connections, and of one with events. */
export const ACCOUNTS_TOOL = "accounts"
export const EVENTS_LIST_TOOL = "events_list"
export const EVENTS_ACK_TOOL = "events_ack"

const EVENT_KIND = /^[a-z][a-z0-9_.-]*$/
const MIN_EVENT_INTERVAL_MS = 10_000
const MAX_EVENT_INTERVAL_MS = 24 * 60 * 60_000
const PROVIDER = /^[a-z][a-z0-9-]*$/

const isFunction = (value: unknown) => typeof value === "function"
const nonEmpty = (value: unknown) => typeof value === "string" && value.trim() !== ""

function timingProblem(tool: BotConnectorToolDefinition<unknown>): string | undefined {
  const { ask } = tool
  if (ask === undefined) return undefined
  const waitMs = ask.waitMs ?? DEFAULT_ASK_WAIT_MS
  const ttlMs = ask.ttlMs ?? DEFAULT_ASK_TTL_MS
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > MAX_ASK_WAIT_MS) {
    return `ask.waitMs must be an integer from 0 to ${MAX_ASK_WAIT_MS}`
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= waitMs || ttlMs > MAX_ASK_TTL_MS) {
    return `ask.ttlMs must be an integer above ask.waitMs and at most ${MAX_ASK_TTL_MS}`
  }
  return undefined
}

function toolProblem(
  connectorId: string,
  tool: BotConnectorToolDefinition<unknown>,
): string | undefined {
  if (typeof tool !== "object" || tool === null) return "is not a tool"
  if (typeof tool.name !== "string" || !ID.test(tool.name)) {
    return "has a name that is not lower-case letters, digits and _, starting with a letter"
  }
  const name = connectorToolName(connectorId, tool.name)
  if (name.length > MAX_TOOL_NAME) {
    return `makes the tool name "${name}", longer than ${MAX_TOOL_NAME} characters`
  }
  if (!nonEmpty(tool.description)) return "has no description"
  if (!CONNECTOR_PERMISSIONS.includes(tool.permission)) {
    return `has permission ${JSON.stringify(tool.permission)}, not one of ${CONNECTOR_PERMISSIONS.join(", ")}`
  }
  if (!isFunction(tool.preview) || !isFunction(tool.execute)) return "needs preview and execute"
  for (const hook of ["recheck", "snapshot"] as const) {
    if (tool[hook] !== undefined && !isFunction(tool[hook])) {
      return `has a ${hook} that is not a function`
    }
  }
  if (
    tool.exclusive !== undefined &&
    (typeof tool.exclusive !== "string" || !EXCLUSIVE.test(tool.exclusive))
  ) {
    return "has an exclusive key that is not lower-case letters, digits, _ and -"
  }
  if (
    tool.maxResultChars !== undefined &&
    (!Number.isSafeInteger(tool.maxResultChars) ||
      tool.maxResultChars < 1 ||
      tool.maxResultChars > MAX_RESULT_CHARS)
  ) {
    return `has maxResultChars that is not an integer from 1 to ${MAX_RESULT_CHARS}`
  }
  if (tool.readOnly !== undefined && typeof tool.readOnly !== "boolean") {
    return "has a readOnly that is not true or false"
  }
  if (tool.vault !== undefined && tool.vault !== true) return "has a vault that is not true"
  if (tool.vault === true && tool.snapshot !== undefined) {
    return "fills logins (vault) and has a snapshot; a snapshot runs before the owner decides, so it may not reach the logins"
  }
  const timing = timingProblem(tool)
  if (timing !== undefined) return timing
  try {
    compileArguments(tool)
  } catch (error) {
    return `has invalid parameters: ${error instanceof Error ? error.message : String(error)}`
  }
  return undefined
}

function minimumSpecProblem(minimumSpec: unknown): string | undefined {
  if (minimumSpec === undefined) return undefined
  if (typeof minimumSpec !== "object" || minimumSpec === null || Array.isArray(minimumSpec)) {
    return "has a minimumSpec that is not an object"
  }
  for (const [key, value] of Object.entries(minimumSpec)) {
    if (!(BOT_ENVIRONMENT_SPEC_KEYS as readonly string[]).includes(key)) {
      return `has a minimumSpec key "${key}" that is not one of ${BOT_ENVIRONMENT_SPEC_KEYS.join(", ")}`
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
      return `has a minimumSpec ${key} that is not a positive integer`
    }
  }
  return undefined
}

function lifecycleProblem(connector: CatalogConnector): string | undefined {
  const { minimumSpec, preparation, attachment } = connector
  const spec = minimumSpecProblem(minimumSpec)
  if (spec !== undefined) return spec
  if (preparation !== undefined) {
    if (!isFunction(preparation.prepare)) return "has a preparation without prepare"
    if (preparation.unprepare !== undefined && !isFunction(preparation.unprepare)) {
      return "has an unprepare that is not a function"
    }
    if (
      preparation.hint !== undefined &&
      (typeof preparation.hint !== "object" || !nonEmpty(preparation.hint?.en))
    ) {
      return "has a preparation hint without English text"
    }
  }
  const { requires } = connector
  if (requires !== undefined) {
    if (!Array.isArray(requires) || requires.some((id) => typeof id !== "string" || !ID.test(id))) {
      return "has requires that are not connector ids"
    }
    if (new Set(requires).size !== requires.length) return "requires a connector twice"
    if (requires.includes(connector.id)) return "requires itself"
  }
  if (connector.creationOption !== undefined && !isBotCreationOption(connector.creationOption)) {
    return `has a creationOption that is not one of ${BOT_CREATION_OPTIONS.join(", ")}`
  }
  if (attachment !== undefined && !isFunction(attachment.open)) {
    return "has an attachment without open"
  }
  return undefined
}

function accountsProblem(connector: CatalogConnector): string | undefined {
  const { connections, events } = connector
  if (connections !== undefined) {
    if (typeof connections !== "object" || connections === null)
      return "has connections that are not an object"
    if (typeof connections.provider !== "string" || !PROVIDER.test(connections.provider)) {
      return "has connections whose provider is not a provider id"
    }
    if (
      !Array.isArray(connections.scopes) ||
      connections.scopes.length === 0 ||
      connections.scopes.some((scope) => typeof scope !== "string" || scope.trim() === "")
    ) {
      return "has connections without scopes"
    }
  }
  if (events === undefined) return undefined
  if (connections === undefined) return "has events but no connections (events come from accounts)"
  if (!isFunction(events.poll)) return "has events without poll"
  if (events.delivery !== "notify" && events.delivery !== "queue") {
    return "has an events delivery that is not notify or queue"
  }
  if (
    !Number.isSafeInteger(events.intervalMs) ||
    events.intervalMs < MIN_EVENT_INTERVAL_MS ||
    events.intervalMs > MAX_EVENT_INTERVAL_MS
  ) {
    return `has an events intervalMs that is not an integer from ${MIN_EVENT_INTERVAL_MS} to ${MAX_EVENT_INTERVAL_MS}`
  }
  if (!Array.isArray(events.kinds) || events.kinds.length === 0) return "has events without kinds"
  for (const kind of events.kinds) {
    if (typeof kind.kind !== "string" || !EVENT_KIND.test(kind.kind)) {
      return "has an event kind that is not lower-case letters, digits, _, . and -"
    }
    if (typeof kind.label !== "object" || !nonEmpty(kind.label?.en)) {
      return `has event kind "${kind.kind}" without an English label`
    }
  }
  return undefined
}

const STREAM = /^[a-z][a-z0-9_-]*$/

function surfaceProblem(connector: CatalogConnector): string | undefined {
  const { panel, status } = connector
  if (panel !== undefined) {
    if (typeof panel !== "object" || panel === null) return "has a panel that is not an object"
    if (typeof panel.title !== "object" || !nonEmpty(panel.title?.en)) {
      return "has a panel without an English title"
    }
    if (!isConnectorPanelIcon(panel.icon)) {
      return `has a panel whose icon is not one of ${CONNECTOR_PANEL_ICONS.join(", ")}`
    }
    if (!Array.isArray(panel.streams)) return "has a panel whose streams are not a list"
    const names = new Set<string>()
    for (const stream of panel.streams) {
      if (typeof stream?.name !== "string" || !STREAM.test(stream.name)) {
        return "has a panel stream whose name is not lower-case letters, digits, _ and -"
      }
      if (names.has(stream.name)) return `has the panel stream "${stream.name}" twice`
      names.add(stream.name)
      if (!isFunction(stream.parse) || !isFunction(stream.open)) {
        return `has the panel stream "${stream.name}" without parse and open`
      }
    }
  }
  if (status !== undefined && (!isFunction(status.read) || !isFunction(status.subscribe))) {
    return "has a status without read and subscribe"
  }
  return undefined
}

/** Tool names bot-core gives the connector itself. */
function reservedTools(connector: CatalogConnector): readonly string[] {
  return [
    ...(connector.connections === undefined ? [] : [ACCOUNTS_TOOL]),
    ...(connector.events === undefined ? [] : [EVENTS_LIST_TOOL, EVENTS_ACK_TOOL]),
  ]
}

/** The arguments the model sees: a connector with connections takes the account first. */
function withAccount(connector: CatalogConnector, schema: JsonSchemaNode): JsonSchemaNode {
  if (connector.connections === undefined) return schema
  const node = schema as {
    readonly properties?: Readonly<Record<string, JsonSchemaNode>>
    readonly required?: readonly string[]
  }
  return {
    ...schema,
    properties: {
      [ACCOUNT_ARGUMENT]: {
        type: "string",
        description: `The account to act as: its email (or its label), as ${connectorToolName(connector.id, ACCOUNTS_TOOL)} lists them.`,
      },
      ...node.properties,
    },
    required: [ACCOUNT_ARGUMENT, ...(node.required ?? [])],
  } as JsonSchemaNode
}

/** Why a connector cannot be registered, or undefined. */
export function connectorProblem(connector: CatalogConnector): string | undefined {
  if (typeof connector !== "object" || connector === null) return "the connector is not an object"
  if (typeof connector.id !== "string" || !ID.test(connector.id)) {
    return "the connector id must be lower-case letters, digits and _, starting with a letter"
  }
  const what = `connector "${connector.id}"`
  if (connector.id === RESERVED_ID)
    return `${what}: the id is bot-core's own (its connector_* tools)`
  if (!nonEmpty(connector.name)) return `${what} has no name`
  if (
    connector.description !== undefined &&
    (typeof connector.description !== "object" || !nonEmpty(connector.description?.en))
  ) {
    return `${what} has a description without English text`
  }
  if (!CONNECTOR_SESSIONS.includes(connector.sessions)) {
    return `${what}: sessions must be one of ${CONNECTOR_SESSIONS.join(", ")}`
  }
  const settings = connectorSettingsProblem(connector.settings ?? [])
  if (settings !== undefined) return `${what}: ${settings}`
  const lifecycle = lifecycleProblem(connector)
  if (lifecycle !== undefined) return `${what} ${lifecycle}`
  const accounts = accountsProblem(connector)
  if (accounts !== undefined) return `${what} ${accounts}`
  const reserved = reservedTools(connector)
  const surface = surfaceProblem(connector)
  if (surface !== undefined) return `${what} ${surface}`
  if (!Array.isArray(connector.tools) || connector.tools.length === 0) {
    return `${what} has no tools`
  }
  const names = new Set<string>()
  for (const [index, tool] of connector.tools.entries()) {
    const problem = toolProblem(connector.id, tool)
    if (problem !== undefined) return `${what}: tool ${index + 1} ${problem}`
    if (names.has(tool.name)) return `${what}: tool "${tool.name}" is declared twice`
    if (reserved.includes(tool.name))
      return `${what}: tool "${tool.name}" is bot-core's own for this connector`
    if (connector.connections !== undefined) {
      const { schema } = compileArguments(tool)
      const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {}
      if (ACCOUNT_ARGUMENT in properties) {
        return `${what}: tool "${tool.name}" declares "${ACCOUNT_ARGUMENT}", which bot-core adds itself`
      }
    }
    names.add(tool.name)
  }
  return undefined
}

export interface ConnectorCatalog {
  /**
   * @throws when the connector is invalid, its id is taken, or one of its
   *   tools would take the name of another registered tool.
   */
  register(connector: CatalogConnector): () => void
  list(): readonly CatalogConnector[]
  get(connectorId: string): CatalogConnector | undefined
  /** Every tool of every registered connector, in registration order. */
  tools(): readonly CatalogTool[]
  tool(connectorId: string, tool: string): CatalogTool | undefined
  /** Called after every registration and unregistration. */
  subscribe(listener: () => void): () => void
}

function catalogTools(connector: CatalogConnector): CatalogTool[] {
  return connector.tools.map((tool) => {
    const own = compileArguments(tool)
    const schema = withAccount(connector, own.schema)
    const accounts = connector.connections !== undefined
    return {
      connector,
      tool,
      name: connectorToolName(connector.id, tool.name),
      waitMs: tool.ask?.waitMs ?? DEFAULT_ASK_WAIT_MS,
      ttlMs: tool.ask?.ttlMs ?? DEFAULT_ASK_TTL_MS,
      maxResultChars: tool.maxResultChars ?? DEFAULT_RESULT_CHARS,
      schema,
      check: accounts ? (args) => validateJsonSchemaValue(schema, args, "arguments") : own.check,
      split(args) {
        if (!accounts || typeof args !== "object" || args === null || Array.isArray(args)) {
          return { own: args }
        }
        const { [ACCOUNT_ARGUMENT]: account, ...rest } = args as {
          readonly [key: string]: ConnectorJson
        }
        return typeof account === "string" ? { account, own: rest } : { own: rest }
      },
    }
  })
}

/** The names a connector's tools take among a bot's tools, bot-core's own for it included. */
export function connectorToolNames(connector: CatalogConnector): readonly string[] {
  return [...connector.tools.map((tool) => tool.name), ...reservedTools(connector)].map((name) =>
    connectorToolName(connector.id, name),
  )
}

export function createConnectorCatalog(): ConnectorCatalog {
  const entries = new Map<string, { connector: CatalogConnector; tools: readonly CatalogTool[] }>()
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  const all = () => [...entries.values()].flatMap((entry) => entry.tools)
  return {
    register(connector) {
      const problem = connectorProblem(connector)
      if (problem !== undefined) throw new Error(`bot-core: ${problem}`)
      if (entries.has(connector.id)) {
        throw new Error(`bot-core: connector "${connector.id}" is already registered`)
      }
      if (
        closesRequirementCycle(
          connector,
          [...entries.values()].map((entry) => entry.connector),
        )
      ) {
        throw new Error(
          `bot-core: connector "${connector.id}" requires a connector that requires it`,
        )
      }
      const tools = catalogTools(connector)
      const taken = new Set(
        [...entries.values()].flatMap((entry) => connectorToolNames(entry.connector)),
      )
      const clash = connectorToolNames(connector).find((name) => taken.has(name))
      if (clash !== undefined) {
        throw new Error(
          `bot-core: connector "${connector.id}" makes tool "${clash}", which another connector has`,
        )
      }
      const entry = { connector, tools }
      entries.set(connector.id, entry)
      publish()
      return () => {
        if (entries.get(connector.id) !== entry) return
        entries.delete(connector.id)
        publish()
      }
    },
    list: () => [...entries.values()].map((entry) => entry.connector),
    get: (connectorId) => entries.get(connectorId)?.connector,
    tools: all,
    tool: (connectorId, tool) =>
      entries.get(connectorId)?.tools.find((entry) => entry.tool.name === tool),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
