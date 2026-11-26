export const PREFLIGHT_CHECK_IDS = [
  "arch",
  "os",
  "kvm",
  "init",
  "disk",
  "privilege",
  "incus",
  "third-party",
  "port",
] as const

export type PreflightCheckId = (typeof PREFLIGHT_CHECK_IDS)[number]

export const HOST_SETUP_FAILURE_CODES = [
  "not-root",
  "os-unsupported",
  "third-party-refused",
  "zabbly-key-mismatch",
  "module-missing",
  "incus-too-old",
  "no-vm-driver",
  "project-conflict",
  "project-in-use",
  "firewall-drops",
  "port-in-use",
  "token-missing",
  "cancelled",
  "command-failed",
] as const

export type HostSetupFailureCode = (typeof HOST_SETUP_FAILURE_CODES)[number]

export const SETUP_FAILURE_CODES = [
  ...HOST_SETUP_FAILURE_CODES,
  "sudo-rejected",
  "ssh-failed",
  "host-key-changed",
  "staging-failed",
  "protocol",
  "endpoint-unreachable",
  "pairing-failed",
  "check-failed",
  "image-failed",
  "interrupted",
] as const

export type SetupFailureCode = (typeof SETUP_FAILURE_CODES)[number]

export type HostSiteView =
  | { readonly kind: "this-machine" }
  | {
      readonly kind: "ssh"
      readonly host: string
      readonly port: number
      readonly user: string
      readonly hostKey: PinnedHostKey
      readonly identity: "kept" | "removed"
    }

export interface SshTarget {
  readonly host: string
  readonly port: number
  readonly user: string
}

export interface PinnedHostKey {
  readonly type: string
  readonly fingerprint: string
}

export interface HostKeyScan {
  readonly target: SshTarget
  readonly keys: readonly PinnedHostKey[]
}

export interface SshIdentityView {
  readonly state: "absent" | "present"
  readonly authorizedKeysLine?: string
  readonly fingerprint?: string
}

export type SetupSite =
  | { readonly kind: "this-machine" }
  | { readonly kind: "ssh"; readonly target: SshTarget; readonly hostKey: PinnedHostKey }

export interface SetupInspectRequest {
  readonly site: SetupSite
  readonly httpsPort: number
}

export interface PreflightCheck {
  readonly id: PreflightCheckId
  readonly state: "ok" | "warning" | "failed"
  readonly value?: string
  readonly what?: string
  readonly fix?: string
}

export interface ConsentNeed {
  readonly kind: "third-party-repository"
  readonly id: "zabbly"
  readonly url: string
  readonly signingKey: string
}

export type SetupInspection =
  | {
      readonly id: string
      readonly at: number
      readonly site: HostSiteView
      readonly checks: readonly PreflightCheck[]
      readonly verdict: "ready"
      readonly privilege: "root" | "sudo-without-password" | "sudo-with-password"
      readonly consents: readonly ConsentNeed[]
    }
  | {
      readonly id: string
      readonly at: number
      readonly site: HostSiteView
      readonly checks: readonly PreflightCheck[]
      readonly verdict: "refused"
      readonly suggestion?: "another-machine"
    }

export interface SetupStartRequest {
  readonly inspectionId: string
  readonly project: string
  readonly httpsPort: number
  readonly sudoPassword?: string
  readonly consents: readonly ConsentNeed["id"][]
  readonly identityAfter?: "keep" | "remove"
}

export type SetupStepId = "packages" | "incus" | "firewall" | "connect" | "image"

export type SetupStepState = "pending" | "running" | "done" | "skipped" | "failed"

export interface SetupStepView {
  readonly id: SetupStepId
  readonly state: SetupStepState
  readonly note?: string
  readonly startedAt?: number
  readonly endedAt?: number
}

export type SetupJobState =
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"

export interface SetupLogLine {
  readonly at: number
  readonly source: "host" | "plugin"
  readonly text: string
}

export interface SetupFailure {
  readonly step: SetupStepId
  readonly code: SetupFailureCode
  readonly what: string
  readonly fix: string
  readonly command?: string
  readonly location?: string
  readonly exitCode?: number
  readonly logTail: readonly string[]
}

export interface SetupJobView {
  readonly id: string
  readonly attempt: number
  readonly site: HostSiteView
  readonly project: string
  readonly state: SetupJobState
  readonly steps: readonly SetupStepView[]
  readonly startedAt: number
  readonly endedAt?: number
  readonly log: { readonly tail: readonly SetupLogLine[]; readonly lines: number }
  readonly failure?: SetupFailure
}

export interface SetupBrief {
  readonly title: string
  readonly cwd: string
  readonly message: string
}
