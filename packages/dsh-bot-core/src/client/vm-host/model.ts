import type {
  BotEnvironmentHostState,
  EnvironmentHostSettingsView,
  TrustTokenPreview,
} from "../../shared/environment-host"
import type { BotEnvironmentImageView } from "../../shared/environment-image"
import type { FeedState } from "../remote-feed"
import type { SettingsBadge } from "../settings-frame/sections"

/** The project a bot environment uses unless told otherwise (docs/specs/incus-endpoint.md §3.4). */
export const DEFAULT_PROJECT = "dsh-bots"

const PROJECT = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/

/** Whether bot VMs may use the project (the Host checks it again). */
export const projectAllowed = (text: string): boolean => {
  const name = text.trim()
  return PROJECT.test(name) && name !== "default"
}

/** An `https://host:port` URL with nothing else (the Host checks it again). */
export function endpointUrlAllowed(text: string): boolean {
  try {
    const url = new URL(text.trim())
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      (url.pathname === "/" || url.pathname === "")
    )
  } catch {
    return false
  }
}

/** A fingerprint in pairs, as `incus info` prints certificate fingerprints. */
export const fingerprintText = (sha256: string) => sha256.match(/.{1,2}/g)?.join(":") ?? sha256

/** The fingerprint's start, as `incus config trust list` names certificates. */
export const shortFingerprint = (sha256: string) => sha256.slice(0, 12)

/** Where the pairing form sends the token: one of its URLs, or one typed (behind NAT). */
export type PairingAddress =
  | { readonly kind: "token"; readonly url: string }
  | { readonly kind: "other"; readonly url: string }

export interface PairingForm {
  readonly preview: TrustTokenPreview | null
  readonly address: PairingAddress | null
  readonly project: string
}

export const emptyPairing = (project: string): PairingForm => ({
  preview: null,
  address: null,
  project,
})

/** The form once a token was read: its first URL is picked. */
export function previewed(form: PairingForm, preview: TrustTokenPreview): PairingForm {
  const first = preview.urls[0]
  return {
    ...form,
    preview,
    address: first === undefined ? { kind: "other", url: "" } : { kind: "token", url: first },
  }
}

/** What the form sends, or null while something is missing. */
export function pairingRequest(
  form: PairingForm,
  token: string,
  now: number,
): { readonly token: string; readonly url: string; readonly project: string } | null {
  const { preview, address } = form
  if (preview === null || address === null) return null
  if (preview.expiresAt !== undefined && preview.expiresAt <= now) return null
  if (!endpointUrlAllowed(address.url) || !projectAllowed(form.project)) return null
  return { token: token.trim(), url: address.url.trim(), project: form.project.trim() }
}

/** The worst thing the section shows: the nav marks it meanwhile. */
export function vmHostBadge(state: FeedState<BotEnvironmentHostState>): SettingsBadge | null {
  if (state.status !== "ready" || state.value.status !== "ready") return null
  const host = state.value.host
  if (host.check.state === "failed") return { tone: "danger", label: (t) => t("vmHost.badge") }
  if (egressOpen(host)) return { tone: "warning", label: (t) => t("egress.badge") }
  if (host.image !== undefined && imageNeedsImport(host.image)) {
    return { tone: "warning", label: (t) => t("image.badge") }
  }
  return null
}

export const egressOpen = (host: EnvironmentHostSettingsView): boolean =>
  host.egress.some((report) => report.measure.state === "open") ||
  (host.check.state === "ready" && host.check.declaration.egressAcl === undefined)

export const imageNeedsImport = (image: BotEnvironmentImageView): boolean =>
  image.status.kind === "missing" || image.status.kind === "failed"

/** Whether the base image can be imported now. */
export const imageImportable = (image: BotEnvironmentImageView): boolean =>
  image.managed &&
  image.release !== undefined &&
  (image.status.kind === "missing" || image.status.kind === "failed")

const GIB = 1024 ** 3

/** Bytes as GiB to a tenth, and the share done. */
export function progressOf(doneBytes: number, totalBytes: number) {
  const tenth = (bytes: number) => Math.round((bytes / GIB) * 10) / 10
  return {
    done: tenth(doneBytes),
    total: tenth(totalBytes),
    percent: totalBytes > 0 ? Math.floor((doneBytes / totalBytes) * 100) : 0,
  }
}
