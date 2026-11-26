import type { BackendPlacementView, EnvironmentHostPlacement } from "../../shared/environment-host"
import type {
  ConsentNeed,
  HostSiteView,
  PinnedHostKey,
  PreflightCheck,
  SetupInspection,
  SetupJobState,
  SetupJobView,
  SetupSite,
  SetupStartRequest,
  SetupStepState,
  SshTarget,
} from "../../shared/vm-host-setup"
import type { PillTone } from "../ui"
import { DEFAULT_PROJECT, projectAllowed } from "./model"

export const DEFAULT_HTTPS_PORT = 8443
export const DEFAULT_SSH_PORT = 22

export type SiteKind = HostSiteView["kind"]

export type BuildIntent =
  | { readonly kind: "new"; readonly site: SiteKind }
  | { readonly kind: "move"; readonly project: string }
  | {
      readonly kind: "again"
      readonly site: HostSiteView
      readonly project: string
      readonly httpsPort: number
    }

export interface BuildSeed {
  readonly site: SiteKind
  readonly fixedSite: SetupSite | null
  readonly project: string
  readonly projectFixed: boolean
  readonly httpsPort: number
}

export function siteOfView(site: HostSiteView): SetupSite {
  switch (site.kind) {
    case "this-machine":
      return { kind: "this-machine" }
    case "ssh":
      return {
        kind: "ssh",
        target: { host: site.host, port: site.port, user: site.user },
        hostKey: site.hostKey,
      }
  }
}

export function seedOf(intent: BuildIntent): BuildSeed {
  switch (intent.kind) {
    case "new":
      return {
        site: intent.site,
        fixedSite: intent.site === "this-machine" ? { kind: "this-machine" } : null,
        project: DEFAULT_PROJECT,
        projectFixed: false,
        httpsPort: DEFAULT_HTTPS_PORT,
      }
    case "move":
      return {
        site: "this-machine",
        fixedSite: { kind: "this-machine" },
        project: intent.project,
        projectFixed: true,
        httpsPort: DEFAULT_HTTPS_PORT,
      }
    case "again":
      return {
        site: intent.site.kind,
        fixedSite: siteOfView(intent.site),
        project: intent.project,
        projectFixed: true,
        httpsPort: intent.httpsPort,
      }
  }
}

export function portOfUrl(url: string): number {
  const parsed = new URL(url)
  return parsed.port === "" ? 443 : Number(parsed.port)
}

export function repairIntent(placement: EnvironmentHostPlacement): BuildIntent | null {
  if (placement.kind !== "placed" || placement.origin.kind !== "managed") return null
  if (placement.backend.kind !== "incus") return null
  return {
    kind: "again",
    site: placement.origin.site,
    project: placement.backend.project,
    httpsPort: portOfUrl(placement.backend.url),
  }
}

export const jobEnded = (job: SetupJobView): boolean =>
  job.state !== "running" && job.state !== "cancelling"

export const jobRetryable = (job: SetupJobView): boolean =>
  job.state === "failed" || job.state === "cancelled" || job.state === "interrupted"

export function retryIntent(job: SetupJobView, placement: EnvironmentHostPlacement): BuildIntent {
  const placedPort =
    placement.kind === "placed" && placement.backend.kind === "incus"
      ? portOfUrl(placement.backend.url)
      : DEFAULT_HTTPS_PORT
  return { kind: "again", site: job.site, project: job.project, httpsPort: placedPort }
}

export function parsePort(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,5}$/.test(trimmed)) return null
  const port = Number(trimmed)
  return port >= 1 && port <= 65535 ? port : null
}

const ADDRESS =
  /^([A-Za-z0-9._][A-Za-z0-9._-]{0,63})@(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/

export function parseAddress(text: string): SshTarget | null {
  const match = ADDRESS.exec(text.trim())
  if (match === null) return null
  const [, user, rawHost, rawPort] = match
  if (user === undefined || rawHost === undefined) return null
  const host = rawHost.startsWith("[") ? rawHost.slice(1, -1) : rawHost
  if (host === "" || host.startsWith("-") || host.startsWith(".")) return null
  const port = rawPort === undefined ? DEFAULT_SSH_PORT : parsePort(rawPort)
  return port === null ? null : { host, port, user }
}

export function addressText(target: SshTarget): string {
  const host = target.host.includes(":") ? `[${target.host}]` : target.host
  return target.port === DEFAULT_SSH_PORT
    ? `${target.user}@${host}`
    : `${target.user}@${host}:${target.port}`
}

const HOST_KEY_FILES: Readonly<Record<string, string>> = {
  "ssh-ed25519": "ed25519",
  "ecdsa-sha2-nistp256": "ecdsa",
  "ecdsa-sha2-nistp384": "ecdsa",
  "ecdsa-sha2-nistp521": "ecdsa",
  "ssh-rsa": "rsa",
}

export function hostKeyCommand(key: PinnedHostKey): string {
  const file = HOST_KEY_FILES[key.type]
  return file === undefined
    ? "ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub"
    : `ssh-keygen -lf /etc/ssh/ssh_host_${file}_key.pub`
}

export interface BuildForm {
  readonly project: string
  readonly httpsPort: number
  readonly sudoPassword: string
  readonly consents: readonly ConsentNeed["id"][]
  readonly identityAfter: "keep" | "remove"
}

export const formOf = (seed: BuildSeed): BuildForm => ({
  project: seed.project,
  httpsPort: seed.httpsPort,
  sudoPassword: "",
  consents: [],
  identityAfter: "keep",
})

export const passwordNeeded = (inspection: SetupInspection): boolean =>
  inspection.verdict === "ready" && inspection.privilege === "sudo-with-password"

export function startRequestOf(
  form: BuildForm,
  inspection: SetupInspection,
): SetupStartRequest | null {
  if (inspection.verdict !== "ready") return null
  if (!projectAllowed(form.project)) return null
  const needsPassword = passwordNeeded(inspection)
  if (needsPassword && form.sudoPassword === "") return null
  if (inspection.consents.some((need) => !form.consents.includes(need.id))) return null
  return {
    inspectionId: inspection.id,
    project: form.project.trim(),
    httpsPort: form.httpsPort,
    ...(needsPassword ? { sudoPassword: form.sudoPassword } : {}),
    consents: inspection.consents.map((need) => need.id),
    ...(inspection.site.kind === "ssh" ? { identityAfter: form.identityAfter } : {}),
  }
}

export type ChangeLine =
  | { readonly key: "changes.packages" }
  | { readonly key: "changes.zabbly" }
  | { readonly key: "changes.incus"; readonly project: string }
  | { readonly key: "changes.firewall" }
  | { readonly key: "changes.https.loopback"; readonly port: number }
  | { readonly key: "changes.https.all"; readonly port: number }
  | { readonly key: "changes.trust"; readonly project: string }
  | { readonly key: "changes.image" }

export function changesOf(
  site: SiteKind,
  form: BuildForm,
  consents: readonly ConsentNeed[],
): readonly ChangeLine[] {
  const project = form.project.trim()
  return [
    { key: "changes.packages" },
    ...(consents.some((need) => need.id === "zabbly") ? [{ key: "changes.zabbly" } as const] : []),
    { key: "changes.incus", project },
    { key: "changes.firewall" },
    site === "this-machine"
      ? { key: "changes.https.loopback", port: form.httpsPort }
      : { key: "changes.https.all", port: form.httpsPort },
    { key: "changes.trust", project },
    { key: "changes.image" },
  ]
}

export function checkTone(check: PreflightCheck): PillTone {
  switch (check.state) {
    case "ok":
      return "success"
    case "warning":
      return "warning"
    case "failed":
      return "danger"
  }
}

export function stepTone(state: SetupStepState): PillTone {
  switch (state) {
    case "pending":
    case "skipped":
      return "idle"
    case "running":
      return "busy"
    case "done":
      return "success"
    case "failed":
      return "danger"
  }
}

export function jobTone(state: SetupJobState): PillTone {
  switch (state) {
    case "running":
    case "cancelling":
      return "busy"
    case "succeeded":
      return "success"
    case "cancelled":
      return "idle"
    case "failed":
    case "interrupted":
      return "danger"
  }
}

export function stepElapsed(
  step: { readonly startedAt?: number; readonly endedAt?: number },
  now: number,
): number | null {
  if (step.startedAt === undefined) return null
  return (step.endedAt ?? now) - step.startedAt
}

export function serverLabelOf(backend: BackendPlacementView): string {
  return new URL(backend.url).host
}

export const createProjectCommand = (version: string): string =>
  [
    `curl -fsSL https://codeload.github.com/1outres/dsh-bots/tar.gz/v${version} | tar -xz --strip-components=1 dsh-bots-${version}/infra`,
    "infra/incus/create-project.sh --help",
  ].join("\n")
