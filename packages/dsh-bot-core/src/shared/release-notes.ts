/** The version recorded for an installation whose notes were never seen: every release up to now is shown. */
export const NO_VERSION = "0.0.0"

/** One dsh-bots release as its GitHub release tells it: the author's Markdown, in English. */
export interface ReleaseNote {
  readonly version: string
  /** The release's Markdown body, drawn as Markdown (never as HTML). */
  readonly body: string
  /** The release's page on GitHub. */
  readonly url: string
}

const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

interface ParsedVersion {
  readonly core: readonly [number, number, number]
  readonly prerelease: readonly string[]
}

/** Whether `value` is a version {@link compareVersions} reads. */
export function isVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION.test(value)
}

function parse(version: string): ParsedVersion {
  const match = VERSION.exec(version)
  if (match === null) throw new Error(`"${version}" is not a MAJOR.MINOR.PATCH version`)
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  }
}

const NUMERIC = /^\d+$/

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = NUMERIC.test(a)
  const bNumeric = NUMERIC.test(b)
  if (aNumeric && bNumeric) return Number(a) - Number(b)
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Semantic version order: negative when `a` is older, positive when newer.
 * @throws when either is not a version.
 */
export function compareVersions(a: string, b: string): number {
  const left = parse(a)
  const right = parse(b)
  for (const index of [0, 1, 2] as const) {
    const difference = left.core[index] - right.core[index]
    if (difference !== 0) return Math.sign(difference)
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length)
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const l = left.prerelease[index]
    const r = right.prerelease[index]
    if (l === undefined || r === undefined) return l === undefined ? -1 : 1
    const difference = compareIdentifiers(l, r)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}

/** Whether `version` is after `seen` and not after `current`: a release whose notes are due. */
export const dueBetween = (version: string, seen: string, current: string): boolean =>
  compareVersions(version, seen) > 0 && compareVersions(version, current) <= 0
