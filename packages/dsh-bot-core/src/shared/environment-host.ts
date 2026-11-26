import type { BotEnvironmentImageView } from "./environment-image"
import type { HostSiteView, SetupJobView } from "./vm-host-setup"

export type VmBackendKind = "incus" | "proxmox"

export const PLACEMENT_PROBLEM_CODES = [
  "stored-unreadable",
  "placement-none",
  "migration-required",
  "secret-missing",
] as const

export const INCUS_PROBLEM_CODES = [
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

export const PROXMOX_PROBLEM_CODES = ["unreachable", "untrusted", "token-rejected"] as const

export type PlacementProblemCode = (typeof PLACEMENT_PROBLEM_CODES)[number]
export type IncusProblemCode = (typeof INCUS_PROBLEM_CODES)[number]
export type ProxmoxProblemCode = (typeof PROXMOX_PROBLEM_CODES)[number]

export type ProblemFix =
  | { readonly kind: "command"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "repair" }
  | { readonly kind: "choose-host" }

export type EnvironmentHostProblem =
  | {
      readonly scope: "placement"
      readonly code: PlacementProblemCode
      readonly message: string
      readonly fix: ProblemFix
    }
  | {
      readonly scope: "incus"
      readonly code: IncusProblemCode
      readonly message: string
      readonly fix: ProblemFix
    }
  | {
      readonly scope: "proxmox"
      readonly code: ProxmoxProblemCode
      readonly message: string
      readonly fix: ProblemFix
    }

export type HostOriginView =
  | { readonly kind: "custom" }
  | {
      readonly kind: "managed"
      readonly site: HostSiteView
      readonly completedAt: number
      readonly update: "current" | "available"
    }

export type BackendPlacementView =
  | {
      readonly kind: "incus"
      readonly url: string
      readonly project: string
      readonly serverFingerprint: string
      readonly clientFingerprint: string
    }
  | {
      readonly kind: "proxmox"
      readonly url: string
      readonly node: string
      readonly pool: string
      readonly tokenId: string
      readonly serverFingerprint: string
    }

export interface LegacyPlacementView {
  readonly kind: "incus-socket"
  readonly socket: string
  readonly project: string
}

export type EnvironmentHostPlacement =
  | { readonly kind: "reading" }
  | { readonly kind: "none" }
  | { readonly kind: "migration-required"; readonly from: LegacyPlacementView }
  | {
      readonly kind: "placed"
      readonly backend: BackendPlacementView
      readonly origin: HostOriginView
    }
  | { readonly kind: "unreadable"; readonly problem: EnvironmentHostProblem }

export type EnvironmentHostDeclaration =
  | {
      readonly kind: "incus"
      readonly pool: string
      readonly network: string
      readonly egressAcl?: string
    }
  | { readonly kind: "proxmox"; readonly node: string; readonly pool: string }

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

export type EnvironmentEgressMeasure =
  | { readonly state: "isolated"; readonly at: number }
  | { readonly state: "open"; readonly at: number; readonly reached: readonly string[] }
  | { readonly state: "unmeasured"; readonly at: number; readonly reason: string }

export interface EnvironmentEgressReport {
  readonly botId: string
  readonly measure: EnvironmentEgressMeasure
}

export interface EnvironmentHostRelease {
  readonly url: string
  readonly clientFingerprint: string
  readonly command: string
}

export interface EnvironmentHostView {
  readonly placement: EnvironmentHostPlacement
  readonly check: EnvironmentHostCheck
  readonly egress: readonly EnvironmentEgressReport[]
  readonly released: readonly EnvironmentHostRelease[]
  readonly setup?: SetupJobView
  readonly image?: BotEnvironmentImageView
}

export interface EnvironmentEgressReportView extends EnvironmentEgressReport {
  readonly botName: string
}

export interface EnvironmentHostSettingsView extends Omit<EnvironmentHostView, "egress"> {
  readonly egress: readonly EnvironmentEgressReportView[]
}

export type BotEnvironmentHostState =
  | { readonly status: "none" }
  | { readonly status: "ready"; readonly host: EnvironmentHostSettingsView }

export interface TrustTokenPreview {
  readonly clientName: string
  readonly serverFingerprint: string
  readonly urls: readonly string[]
  readonly expiresAt?: number
}

export type CustomCredential =
  | { readonly backend: "incus"; readonly trustToken: string }
  | {
      readonly backend: "proxmox"
      readonly url: string
      readonly tokenId: string
      readonly serverFingerprint: string
    }

export type CustomPreview =
  | ({ readonly backend: "incus" } & TrustTokenPreview)
  | {
      readonly backend: "proxmox"
      readonly url: string
      readonly tokenId: string
      readonly serverFingerprint: string
    }

export type CustomConnectRequest =
  | {
      readonly backend: "incus"
      readonly token: string
      readonly url: string
      readonly project: string
    }
  | {
      readonly backend: "proxmox"
      readonly url: string
      readonly tokenId: string
      readonly tokenSecret: string
      readonly serverFingerprint: string
      readonly node: string
      readonly pool: string
    }

export interface BotEnvironmentHostApi {
  watch(signal?: AbortSignal): AsyncIterable<BotEnvironmentHostState>
  check(): Promise<BotEnvironmentHostState>
  previewCustom(credential: CustomCredential): Promise<CustomPreview>
  connectCustom(request: CustomConnectRequest): Promise<BotEnvironmentHostState>
  forget(): Promise<BotEnvironmentHostState>
  refreshImage(): Promise<BotEnvironmentHostState>
  startImage(): Promise<BotEnvironmentHostState>
  cancelImage(): Promise<BotEnvironmentHostState>
}
