import type { VaultRevealKind } from "@1outres/dsh-bot-core"
import {
  boolean,
  type Check,
  type Checked,
  either,
  finite,
  integer,
  json,
  list,
  literal,
  matching,
  nullable,
  object,
  oneOf,
  text,
  tuple,
} from "./check"

export const ELEMENT_ID = /^[0-9]{1,9}:[0-9]{1,9}$/
export const LAUNCHABLE_APPS = ["writer", "calc", "impress", "chrome", "terminal", "files"] as const
export const ACT_ACTIONS = [
  "press",
  "focus",
  "set_text",
  "set_value",
  "select",
  "click",
  "activate",
  "scroll_into_view",
] as const
export const BUTTONS = ["left", "middle", "right"] as const
export const MODIFIERS = ["ctrl", "shift", "alt", "super"] as const
export const SCROLL_DIRECTIONS = ["up", "down", "left", "right"] as const
export const PASTE_COMBOS = ["ctrl+v", "ctrl+shift+v"] as const
export const KEY_COMBO = /^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/
export const TYPED_FIELDS = [
  "username",
  "password",
  "otp",
] as const satisfies readonly VaultRevealKind[]
export type TypedField = (typeof TYPED_FIELDS)[number]

const NAME = 2_000
const LONG_TEXT = 20_000
const COORDINATE = integer(-100_000, 100_000)
const MAX_SCREEN = 8192

const elementId = matching(ELEMENT_ID, 24)
const size = object({ width: integer(1, MAX_SCREEN), height: integer(1, MAX_SCREEN) })
const window = object({ app: text(NAME), role: text(200), name: text(NAME) })
const windowEntry = object({
  id: elementId,
  app: text(NAME),
  role: text(200),
  name: text(NAME),
  active: boolean,
})
const focus = nullable(object({ role: text(200), name: text(NAME) }))
const where = { active_window: nullable(window), focus }
const target = either(
  object({ gone: literal(true) }),
  object(
    { role: text(200), name: text(NAME), states: list(text(64), 32) },
    { text: text(LONG_TEXT), value: finite },
  ),
)
const tree = either(text(400_000), json(96, 400_000))

export const RESULTS = {
  status: object({ screen: size, windows: list(windowEntry, 200), focus }),
  launch: object({ unit: text(200), opened: list(window, 50), ...where }),
  tree: object({
    snapshot: integer(0, 1e9),
    nodes: integer(0, 100_000),
    ms: integer(0, 1e9),
    tree,
  }),
  find: object({
    snapshot: integer(0, 1e9),
    matches: integer(0, 10_000),
    visited: integer(0, 1e9),
    truncated: boolean,
    ms: integer(0, 1e9),
    results: tree,
  }),
  act: object(
    { target },
    {
      opened: list(window, 50),
      closed: list(window, 50),
      active_window: nullable(window),
      focus,
    },
  ),
  text: object({ length: integer(0, 1e9), offset: integer(0, 1e9), text: text(LONG_TEXT) }),
  input: object(where, {
    via: oneOf(["typed", "pasted"]),
    pointer: object({ x: COORDINATE, y: COORDINATE }),
  }),
  sequence: object({ steps: integer(0, 100_000), ...where }),
  cursor: object({ x: COORDINATE, y: COORDINATE, screen: size }),
  clipboard_get: object({ length: integer(0, 1e9), text: text(LONG_TEXT) }),
  clipboard_set: object({ length: integer(0, 1e9) }),
  screenshot: object({
    format: oneOf(["png", "jpeg"]),
    width: integer(1, MAX_SCREEN),
    height: integer(1, MAX_SCREEN),
    bytes: integer(1, 16 << 20),
    region: tuple(COORDINATE, 4),
    screen: tuple(integer(1, MAX_SCREEN), 2),
    data: text(22 << 20),
  }),
  sheet_read: object(
    {
      name: text(NAME),
      rows: integer(1, 1 << 24),
      columns: integer(1, 1 << 20),
      range: text(32),
      cells: list(
        object({ address: matching(/^[A-Z]{1,4}[0-9]{1,8}$/, 16), text: text(LONG_TEXT) }),
        480,
      ),
      truncated: boolean,
      window: object({ id: elementId, app: text(NAME), role: text(200), name: text(NAME) }),
    },
    { visible: text(32), active: text(32) },
  ),
  secret_target: object({
    token: matching(/^[0-9a-f]{32}$/, 32),
    application: text(NAME),
    role: text(200),
    name: text(NAME),
  }),
  type_secret: object({ application: text(NAME), ...where }),
} satisfies Record<string, Check<unknown>>

export type SecretAgentMethod = keyof SecretAgentParams
export type AgentMethod = Exclude<keyof typeof RESULTS, SecretAgentMethod>
export type AgentResult<M extends keyof typeof RESULTS> = Checked<(typeof RESULTS)[M]>
export type AgentWindow = Checked<typeof window>
export type AgentFocus = Checked<typeof focus>

export type AgentPoint = { readonly x: number; readonly y: number } | { readonly element: string }

export type AgentInput =
  | {
      readonly kind: "click"
      readonly at: AgentPoint
      readonly button: (typeof BUTTONS)[number]
      readonly count: number
      readonly modifiers: readonly (typeof MODIFIERS)[number][]
    }
  | { readonly kind: "move"; readonly at: AgentPoint }
  | {
      readonly kind: "mouse_down" | "mouse_up"
      readonly at: AgentPoint
      readonly button: (typeof BUTTONS)[number]
    }
  | {
      readonly kind: "scroll"
      readonly at: AgentPoint
      readonly direction: (typeof SCROLL_DIRECTIONS)[number]
      readonly amount: number
    }
  | {
      readonly kind: "drag"
      readonly from: AgentPoint
      readonly to: AgentPoint
      readonly button: (typeof BUTTONS)[number]
    }
  | { readonly kind: "key"; readonly keys: readonly string[] }
  | { readonly kind: "hold_key"; readonly keys: string; readonly duration_ms: number }
  | { readonly kind: "type"; readonly text: string; readonly paste: (typeof PASTE_COMBOS)[number] }

export type AgentStep = (
  | AgentInput
  | { readonly kind: "activate"; readonly id: string }
  | { readonly kind: "await_focus"; readonly role: string; readonly timeout_ms: number }
) & {
  readonly settle_ms?: number
}

export interface ScreenExpectation {
  readonly expect_screen?: { readonly width: number; readonly height: number }
}

export interface AgentParams {
  status: Record<string, never>
  launch: { readonly app: (typeof LAUNCHABLE_APPS)[number]; readonly args: readonly string[] }
  tree: {
    readonly scope: string
    readonly format: "text" | "json"
    readonly max_nodes: number
    readonly max_depth: number
    readonly max_text: number
    readonly geometry: boolean
  }
  find: {
    readonly scope: string
    readonly format: "text" | "json"
    readonly role?: string
    readonly name?: string
    readonly text?: string
    readonly states?: readonly string[]
    readonly limit: number
    readonly visit_budget: number
    readonly max_text: number
    readonly geometry: boolean
  }
  act: ScreenExpectation & {
    readonly id: string
    readonly action: (typeof ACT_ACTIONS)[number]
    readonly text?: string
    readonly value?: number
    readonly action_name?: string
    readonly button?: (typeof BUTTONS)[number]
    readonly count?: number
  }
  text: { readonly id: string; readonly offset: number; readonly limit: number }
  input: ScreenExpectation & AgentInput
  sequence: ScreenExpectation & { readonly steps: readonly AgentStep[]; readonly settle_ms: number }
  cursor: Record<string, never>
  clipboard_get: { readonly limit: number }
  clipboard_set: { readonly text: string }
  screenshot: ScreenExpectation & {
    readonly target?: string
    readonly region?: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
    readonly width?: number
    readonly format: "png" | "jpeg"
  }
  sheet_read: { readonly range?: string; readonly max_cells: number }
  secret_target: { readonly field: TypedField; readonly element?: string }
}

export interface SecretAgentParams {
  type_secret: { readonly token: string; readonly submit: boolean }
}

export const METHOD_TIMEOUT_MS: Record<keyof typeof RESULTS, number> = {
  status: 15_000,
  launch: 45_000,
  tree: 30_000,
  find: 30_000,
  act: 15_000,
  text: 15_000,
  input: 20_000,
  sequence: 180_000,
  cursor: 10_000,
  clipboard_get: 15_000,
  clipboard_set: 15_000,
  screenshot: 30_000,
  sheet_read: 60_000,
  secret_target: 15_000,
  type_secret: 75_000,
}
