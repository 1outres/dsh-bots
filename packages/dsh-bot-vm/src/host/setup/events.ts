import type {
  HostSetupFailureCode,
  PreflightCheckId,
  SetupFailureCode,
} from "@1outres/dsh-bot-core"

const keysOf = <K extends string>(record: Readonly<Record<K, true>>) => Object.keys(record) as K[]

export const PREFLIGHT_CHECK_IDS = keysOf<PreflightCheckId>({
  arch: true,
  os: true,
  kvm: true,
  init: true,
  disk: true,
  privilege: true,
  incus: true,
  "third-party": true,
  port: true,
})

const HOST_FAILURES: Readonly<Record<HostSetupFailureCode, true>> = {
  "not-root": true,
  "os-unsupported": true,
  "third-party-refused": true,
  "zabbly-key-mismatch": true,
  "module-missing": true,
  "incus-too-old": true,
  "no-vm-driver": true,
  "project-conflict": true,
  "project-in-use": true,
  "firewall-drops": true,
  "port-in-use": true,
  "token-missing": true,
  cancelled: true,
  "command-failed": true,
}

export const HOST_SETUP_FAILURE_CODES = keysOf(HOST_FAILURES)

export const SETUP_FAILURE_CODES = keysOf<SetupFailureCode>({
  ...HOST_FAILURES,
  "sudo-rejected": true,
  "ssh-failed": true,
  "host-key-changed": true,
  "staging-failed": true,
  protocol: true,
  "endpoint-unreachable": true,
  "pairing-failed": true,
  "check-failed": true,
  "image-failed": true,
  interrupted: true,
})

export const HOST_SETUP_PHASES = [
  "preflight",
  "packages",
  "incus",
  "firewall",
  "https",
  "token",
] as const

export type HostSetupPhase = (typeof HOST_SETUP_PHASES)[number]

export const PREFLIGHT_CHECK_CODES = [
  "arch-unsupported",
  "os-unsupported",
  "os-dsh-host-only",
  "kvm-missing",
  "systemd-missing",
  "disk-low",
  "sudo-missing",
  "incus-present",
  "consent-needed",
  "port-maybe-incus",
  "port-in-use",
] as const

export type PreflightCheckCode = (typeof PREFLIGHT_CHECK_CODES)[number]

export const HOST_SETUP_FACT_KEYS = [
  "os",
  "incus-version",
  "https-address",
  "server-fingerprint",
  "project",
  "pool",
  "network",
  "egress-acl",
] as const

export type HostSetupFactKey = (typeof HOST_SETUP_FACT_KEYS)[number]

export type CheckState = "ok" | "warning" | "failed"

export type HostSetupEvent =
  | { readonly v: 1; readonly type: "hello"; readonly version: string; readonly uid: number }
  | {
      readonly v: 1
      readonly type: "check"
      readonly id: PreflightCheckId
      readonly state: CheckState
      readonly value: string
      readonly code?: PreflightCheckCode
      readonly what?: string
      readonly fix?: string
    }
  | { readonly v: 1; readonly type: "phase-start"; readonly phase: HostSetupPhase }
  | {
      readonly v: 1
      readonly type: "phase-done"
      readonly phase: HostSetupPhase
      readonly changed: boolean
      readonly note?: string
    }
  | {
      readonly v: 1
      readonly type: "phase-failed"
      readonly phase: HostSetupPhase
      readonly code: HostSetupFailureCode
      readonly what: string
      readonly fix: string
      readonly command?: string
      readonly location?: string
      readonly exit?: number
    }
  | { readonly v: 1; readonly type: "fact"; readonly key: HostSetupFactKey; readonly value: string }
  | { readonly v: 1; readonly type: "token"; readonly token: string }
  | { readonly v: 1; readonly type: "end"; readonly ok: boolean }

export class SetupProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SetupProtocolError"
  }
}

type Fields = Readonly<Record<string, unknown>>

const refuse = (message: string): never => {
  throw new SetupProtocolError(`host-setup.sh broke its event contract: ${message}`)
}

function text(record: Fields, key: string): string {
  const value = record[key]
  if (typeof value !== "string")
    return refuse(`"${key}" of a ${String(record.type)} event is not text`)
  return value
}

function optionalText(record: Fields, key: string): { readonly [key: string]: string } {
  return record[key] === undefined ? {} : { [key]: text(record, key) }
}

function wholeNumber(record: Fields, key: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return refuse(`"${key}" of a ${String(record.type)} event is not a whole number`)
  }
  return value
}

function boolean(record: Fields, key: string): boolean {
  const value = record[key]
  if (typeof value !== "boolean")
    return refuse(`"${key}" of a ${String(record.type)} event is not true or false`)
  return value
}

function oneOf<T extends string>(record: Fields, key: string, values: readonly T[]): T {
  const value = text(record, key)
  if (!(values as readonly string[]).includes(value)) {
    return refuse(`"${key}" of a ${String(record.type)} event is the unknown "${value}"`)
  }
  return value as T
}

const CHECK_STATES: readonly CheckState[] = ["ok", "warning", "failed"]

export function parseHostSetupEvent(line: string): HostSetupEvent {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return refuse(`a line of ${line.length} characters is not JSON`)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return refuse("a line is not a JSON object")
  }
  const record = value as Fields
  if (record.v !== 1) return refuse(`an event has the unknown version ${String(record.v)}`)
  switch (record.type) {
    case "hello":
      return {
        v: 1,
        type: "hello",
        version: text(record, "version"),
        uid: wholeNumber(record, "uid"),
      }
    case "check": {
      const code =
        record.code === undefined ? {} : { code: oneOf(record, "code", PREFLIGHT_CHECK_CODES) }
      return {
        v: 1,
        type: "check",
        id: oneOf(record, "id", PREFLIGHT_CHECK_IDS),
        state: oneOf(record, "state", CHECK_STATES),
        value: text(record, "value"),
        ...code,
        ...optionalText(record, "what"),
        ...optionalText(record, "fix"),
      }
    }
    case "phase-start":
      return { v: 1, type: "phase-start", phase: oneOf(record, "phase", HOST_SETUP_PHASES) }
    case "phase-done":
      return {
        v: 1,
        type: "phase-done",
        phase: oneOf(record, "phase", HOST_SETUP_PHASES),
        changed: boolean(record, "changed"),
        ...optionalText(record, "note"),
      }
    case "phase-failed":
      return {
        v: 1,
        type: "phase-failed",
        phase: oneOf(record, "phase", HOST_SETUP_PHASES),
        code: oneOf(record, "code", HOST_SETUP_FAILURE_CODES),
        what: text(record, "what"),
        fix: text(record, "fix"),
        ...optionalText(record, "command"),
        ...optionalText(record, "location"),
        ...(record.exit === undefined ? {} : { exit: wholeNumber(record, "exit") }),
      }
    case "fact":
      return {
        v: 1,
        type: "fact",
        key: oneOf(record, "key", HOST_SETUP_FACT_KEYS),
        value: text(record, "value"),
      }
    case "token": {
      const token = text(record, "token")
      if (!/^[A-Za-z0-9+/=]+$/.test(token)) return refuse("the token event carries no token")
      return { v: 1, type: "token", token }
    }
    case "end":
      return { v: 1, type: "end", ok: boolean(record, "ok") }
    default:
      return refuse(`an event has the unknown type ${JSON.stringify(record.type)}`)
  }
}
