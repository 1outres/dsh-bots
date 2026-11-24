import {
  BOT_ENVIRONMENT_SPEC_KEYS,
  type BotEnvironmentCapacity,
  type BotEnvironmentNeed,
  type BotEnvironmentSpec,
  type BotEnvironmentSpecKey,
  type BotEnvironmentSpecProblem,
  environmentSpecProblems,
} from "../../shared/environment"

/** What each field of the VM page holds: CPUs as a count, memory and disk in GiB. */
export type EnvironmentDraft = { readonly [Key in BotEnvironmentSpecKey]: string }

/** How many MiB or GiB one unit a field shows is. */
const PER_UNIT: { readonly [Key in BotEnvironmentSpecKey]: number } = {
  cpus: 1,
  memoryMiB: 1024,
  diskGiB: 1,
}

/** A key's value as its field shows it. */
export function fieldText(key: BotEnvironmentSpecKey, value: number): string {
  return String(Math.round((value / PER_UNIT[key]) * 1000) / 1000)
}

export function draftOf(spec: BotEnvironmentSpec): EnvironmentDraft {
  return Object.fromEntries(
    BOT_ENVIRONMENT_SPEC_KEYS.map((key) => [key, fieldText(key, spec[key])]),
  ) as EnvironmentDraft
}

const NUMBER = /^\s*\d+(?:\.\d+)?\s*$/

/** A field's text as the key's value, or undefined when it is not a number of whole units of the key. */
export function parseField(key: BotEnvironmentSpecKey, text: string): number | undefined {
  if (!NUMBER.test(text)) return undefined
  const value = Number(text) * PER_UNIT[key]
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/** Where the draft stands against the stored spec. */
export interface DraftCheck {
  /** The whole spec the draft makes, when every field reads. */
  readonly spec?: BotEnvironmentSpec
  /** Fields that do not read as a number. */
  readonly unreadable: readonly BotEnvironmentSpecKey[]
  /** What the Host would refuse, per changed key. */
  readonly problems: readonly BotEnvironmentSpecProblem[]
  /** Keys whose value differs from the stored one. */
  readonly changed: readonly BotEnvironmentSpecKey[]
}

export function checkDraft(
  draft: EnvironmentDraft,
  stored: BotEnvironmentSpec,
  capacity: BotEnvironmentCapacity | undefined,
  needs: readonly BotEnvironmentNeed[],
): DraftCheck {
  const unreadable = BOT_ENVIRONMENT_SPEC_KEYS.filter(
    (key) => parseField(key, draft[key]) === undefined,
  )
  if (unreadable.length > 0) return { unreadable, problems: [], changed: [] }
  const spec = Object.fromEntries(
    BOT_ENVIRONMENT_SPEC_KEYS.map((key) => [key, parseField(key, draft[key])]),
  ) as BotEnvironmentSpec
  const changed = BOT_ENVIRONMENT_SPEC_KEYS.filter((key) => spec[key] !== stored[key])
  const problems =
    capacity === undefined ? [] : environmentSpecProblems(stored, spec, capacity, needs)
  return { spec, unreadable, problems, changed }
}

/** The most an enabled connector needs of `key`, with those needing it. */
export function neededOf(
  needs: readonly BotEnvironmentNeed[],
  key: BotEnvironmentSpecKey,
): { readonly value: number; readonly connectors: readonly string[] } | undefined {
  const listed = needs.filter((need) => need.minimum[key] !== undefined)
  if (listed.length === 0) return undefined
  const value = Math.max(...listed.map((need) => need.minimum[key] ?? 0))
  return {
    value,
    connectors: listed.filter((need) => need.minimum[key] === value).map((need) => need.connector),
  }
}
