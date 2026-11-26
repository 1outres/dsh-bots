import type { BotEnvironmentImageView } from "./environment-image"

/**
 * Where the registered environment runs the bots' VMs: the "VM host" of the
 * dsh-bots settings (docs/specs/incus-endpoint.md §3, §4). The Host's texts
 * (`message`, `fix`, `reason`) are English; the codes name what they are.
 */

/** Why the VM host cannot hold bot VMs (docs/specs/incus-endpoint.md §5.1). */
export const ENVIRONMENT_HOST_PROBLEM_CODES = [
  "stored-unreadable",
  "project-default",
  "unreachable",
  "untrusted",
  "incus-too-old",
  "no-vm-driver",
  "project-missing",
  "project-unrestricted",
  "pool-undeclared",
  "pool-unusable",
  "network-undeclared",
  "network-unusable",
  "profile-foreign-device",
] as const

export type EnvironmentHostProblemCode = (typeof ENVIRONMENT_HOST_PROBLEM_CODES)[number]

/** Something missing, in English, with what to run or do about it. */
export interface EnvironmentHostProblem {
  readonly code: EnvironmentHostProblemCode
  readonly message: string
  readonly fix: string
}

/**
 * The VM host in use:
 * - `local`: this machine's Incus socket; `chosen` is false while nothing is
 *   stored (this machine by default);
 * - `remote`: a VM host paired over HTTPS, its server certificate pinned;
 * - `unreadable`: the stored choice cannot be read (choose again);
 * - `reading`: not read yet.
 */
export type EnvironmentHostPlacement =
  | { readonly kind: "reading" }
  | {
      readonly kind: "local"
      readonly socket: string
      readonly project: string
      readonly chosen: boolean
    }
  | {
      readonly kind: "remote"
      readonly url: string
      readonly project: string
      /** Lowercase hex SHA-256 of the server certificate pinned at pairing. */
      readonly serverFingerprint: string
      /** Lowercase hex SHA-256 of this installation's client certificate. */
      readonly clientFingerprint: string
    }
  | { readonly kind: "unreadable"; readonly problem: EnvironmentHostProblem }

/** What the VM host's project declares for dsh-bots (`user.dsh-bots.*`). */
export interface EnvironmentHostDeclaration {
  readonly pool: string
  readonly network: string
  /** The egress ACL its administrator says the network applies; absent when not declared. */
  readonly egressAcl?: string
}

/** The latest check of the VM host and project (`at`: epoch ms). */
export type EnvironmentHostCheck =
  | { readonly state: "unchecked" }
  | { readonly state: "checking" }
  | {
      readonly state: "ready"
      readonly at: number
      readonly declaration: EnvironmentHostDeclaration
    }
  | {
      readonly state: "failed"
      readonly at: number
      readonly problems: readonly EnvironmentHostProblem[]
    }

/**
 * What a bot's VM reached from inside that it must not (docs/specs/incus-endpoint.md
 * §6.4), measured at the end of its latest ensure: `reached` lists `host:port`.
 */
export type EnvironmentEgressMeasure =
  | { readonly state: "isolated"; readonly at: number }
  | { readonly state: "open"; readonly at: number; readonly reached: readonly string[] }
  | { readonly state: "unmeasured"; readonly at: number; readonly reason: string }

export interface EnvironmentEgressReport {
  readonly botId: string
  readonly measure: EnvironmentEgressMeasure
}

/**
 * A paired VM host that was left: a restricted client certificate cannot
 * remove itself (docs/specs/incus-endpoint.md §4), so its administrator runs
 * `command` on it.
 */
export interface EnvironmentHostRelease {
  readonly url: string
  readonly clientFingerprint: string
  readonly command: string
}

/** The VM host as the environment sees it now. */
export interface EnvironmentHostView {
  readonly placement: EnvironmentHostPlacement
  readonly check: EnvironmentHostCheck
  /** One per bot measured since the VM host was chosen, by bot id. */
  readonly egress: readonly EnvironmentEgressReport[]
  /** Paired VM hosts left in this process whose trust is still to be removed there. */
  readonly released: readonly EnvironmentHostRelease[]
  /** Absent when the environment does not import its base image. */
  readonly image?: BotEnvironmentImageView
}

/** A bot's name beside its egress report, for the settings. */
export interface EnvironmentEgressReportView extends EnvironmentEgressReport {
  readonly botName: string
}

export interface EnvironmentHostSettingsView extends Omit<EnvironmentHostView, "egress"> {
  readonly egress: readonly EnvironmentEgressReportView[]
}

/**
 * The VM host section of the dsh-bots settings: `none` while no environment
 * is registered, or the registered one has no VM host to choose.
 */
export type BotEnvironmentHostState =
  | { readonly status: "none" }
  | { readonly status: "ready"; readonly host: EnvironmentHostSettingsView }

/** What an Incus trust token says before it is used (nothing is sent with it). */
export interface TrustTokenPreview {
  readonly clientName: string
  /** Lowercase hex SHA-256 of the server certificate the pairing will pin. */
  readonly serverFingerprint: string
  /** The `https://host:port` URLs of the token's addresses, in its order. */
  readonly urls: readonly string[]
  /** Epoch ms; absent when it does not expire. */
  readonly expiresAt?: number
}

/** Pairing with a VM host: the whole token, the URL it is reached at from here, its project. */
export interface EnvironmentHostPairing {
  readonly token: string
  readonly url: string
  readonly project: string
}

/** The `botEnvironmentHost` Remote. */
export interface BotEnvironmentHostApi {
  /** The section now, then after every change. */
  watch(signal?: AbortSignal): AsyncIterable<BotEnvironmentHostState>
  /** Check the VM host and project again. */
  check(): Promise<BotEnvironmentHostState>
  /** @throws when the text is not a trust token. */
  previewToken(token: string): Promise<TrustTokenPreview>
  /**
   * Pair with a VM host and use it: bots are ensured there again (their files
   * on the earlier VM host are not moved).
   * @throws with what went wrong; nothing is changed then.
   */
  pair(pairing: EnvironmentHostPairing): Promise<BotEnvironmentHostState>
  /** Use this machine's Incus socket with `project`. */
  useLocal(project: string): Promise<BotEnvironmentHostState>
  /** Use another project on the same VM host. */
  setProject(project: string): Promise<BotEnvironmentHostState>
  /** Forget the chosen VM host: this machine's socket by default again. */
  forget(): Promise<BotEnvironmentHostState>
  /** Look at the base image in the project again. */
  refreshImage(): Promise<BotEnvironmentHostState>
  /** Start importing the base image (or join the running import). */
  startImage(): Promise<BotEnvironmentHostState>
  cancelImage(): Promise<BotEnvironmentHostState>
}
