import type { BotEnvironmentImageView } from "./environment-image"

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

export interface EnvironmentHostProblem {
  readonly code: EnvironmentHostProblemCode
  readonly message: string
  readonly fix: string
}

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
      readonly serverFingerprint: string
      readonly clientFingerprint: string
    }
  | { readonly kind: "unreadable"; readonly problem: EnvironmentHostProblem }

export interface EnvironmentHostDeclaration {
  readonly pool: string
  readonly network: string
  readonly egressAcl?: string
}

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

export interface EnvironmentHostPairing {
  readonly token: string
  readonly url: string
  readonly project: string
}

export interface BotEnvironmentHostApi {
  watch(signal?: AbortSignal): AsyncIterable<BotEnvironmentHostState>
  check(): Promise<BotEnvironmentHostState>
  previewToken(token: string): Promise<TrustTokenPreview>
  pair(pairing: EnvironmentHostPairing): Promise<BotEnvironmentHostState>
  useLocal(project: string): Promise<BotEnvironmentHostState>
  setProject(project: string): Promise<BotEnvironmentHostState>
  forget(): Promise<BotEnvironmentHostState>
  refreshImage(): Promise<BotEnvironmentHostState>
  startImage(): Promise<BotEnvironmentHostState>
  cancelImage(): Promise<BotEnvironmentHostState>
}
