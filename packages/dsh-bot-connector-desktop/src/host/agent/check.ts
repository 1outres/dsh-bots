/**
 * Checks of untrusted JSON (the desktop agent runs in the bot's VM, where the
 * bot can replace it): each check returns the value typed or throws naming
 * the path of the first problem.
 */
import type { ConnectorJson } from "@1outres/dsh-bot-core"

export type Check<T> = (value: unknown, path: string) => T
export type Checked<C> = C extends Check<infer T> ? T : never

export class AgentResponseError extends Error {
  constructor(path: string, problem: string) {
    super(`the desktop agent answered something unexpected: ${path} ${problem}`)
    this.name = "AgentResponseError"
  }
}

const fail = (path: string, problem: string): never => {
  throw new AgentResponseError(path, problem)
}

export const text =
  (maxLength: number): Check<string> =>
  (value, path) =>
    typeof value !== "string"
      ? fail(path, "is not text")
      : value.length > maxLength
        ? fail(path, `is longer than ${maxLength} characters`)
        : value

export const matching =
  (pattern: RegExp, maxLength: number): Check<string> =>
  (value, path) => {
    const checked = text(maxLength)(value, path)
    return pattern.test(checked) ? checked : fail(path, "has an invalid format")
  }

export const integer =
  (min: number, max: number): Check<number> =>
  (value, path) =>
    typeof value !== "number" || !Number.isSafeInteger(value)
      ? fail(path, "is not an integer")
      : value < min || value > max
        ? fail(path, `is not from ${min} to ${max}`)
        : value

export const finite: Check<number> = (value, path) =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(path, "is not a number")

export const boolean: Check<boolean> = (value, path) =>
  typeof value === "boolean" ? value : fail(path, "is not true or false")

export const oneOf =
  <const T extends readonly string[]>(options: T): Check<T[number]> =>
  (value, path) =>
    typeof value === "string" && options.includes(value)
      ? (value as T[number])
      : fail(path, `is not one of ${options.join(", ")}`)

export const literal =
  <const T extends string | boolean>(expected: T): Check<T> =>
  (value, path) =>
    value === expected ? expected : fail(path, `is not ${JSON.stringify(expected)}`)

export const nullable =
  <T>(check: Check<T>): Check<T | null> =>
  (value, path) =>
    value === null ? null : check(value, path)

export const list =
  <T>(item: Check<T>, maxItems: number): Check<T[]> =>
  (value, path) => {
    if (!Array.isArray(value)) return fail(path, "is not a list")
    if (value.length > maxItems) return fail(path, `has more than ${maxItems} items`)
    return value.map((entry, index) => item(entry, `${path}[${index}]`))
  }

export const tuple =
  <T>(item: Check<T>, length: number): Check<T[]> =>
  (value, path) => {
    const items = list(item, length)(value, path)
    return items.length === length ? items : fail(path, `does not have ${length} items`)
  }

type Fields = Record<string, Check<unknown>>
type OptionalFields<F extends Fields> = { readonly [K in keyof F]?: Checked<F[K]> }
type RequiredFields<F extends Fields> = { readonly [K in keyof F]: Checked<F[K]> }

/** An object with these fields (`optional` ones may be absent); other fields are dropped. */
export const object =
  <R extends Fields, O extends Fields = Record<never, Check<unknown>>>(
    required: R,
    optional?: O,
  ): Check<RequiredFields<R> & OptionalFields<O>> =>
  (value, path) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return fail(path, "is not an object")
    }
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, check] of Object.entries(required)) {
      out[key] = check(source[key], `${path}.${key}`)
    }
    for (const [key, check] of Object.entries(optional ?? {})) {
      if (source[key] !== undefined) out[key] = check(source[key], `${path}.${key}`)
    }
    return out as RequiredFields<R> & OptionalFields<O>
  }

/** The first of the checks that accepts the value. */
export const either =
  <A, B>(first: Check<A>, second: Check<B>): Check<A | B> =>
  (value, path) => {
    try {
      return first(value, path)
    } catch (error) {
      if (!(error instanceof AgentResponseError)) throw error
      return second(value, path)
    }
  }

/** Any JSON, bounded in depth and size (as JSON text). */
export const json =
  (maxDepth: number, maxLength: number): Check<ConnectorJson> =>
  (value, path) => {
    const walk = (item: unknown, depth: number): void => {
      if (depth > maxDepth) fail(path, `is nested deeper than ${maxDepth}`)
      if (item === null || typeof item === "string" || typeof item === "boolean") return
      if (typeof item === "number") {
        if (!Number.isFinite(item)) fail(path, "holds a number that is not finite")
        return
      }
      if (Array.isArray(item)) {
        for (const entry of item) walk(entry, depth + 1)
        return
      }
      if (typeof item === "object") {
        for (const entry of Object.values(item)) walk(entry, depth + 1)
        return
      }
      fail(path, "is not JSON")
    }
    walk(value, 0)
    if (JSON.stringify(value).length > maxLength)
      fail(path, `is longer than ${maxLength} characters`)
    return value as ConnectorJson
  }
