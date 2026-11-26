import type { HostKeyScan, PinnedHostKey, SshIdentityView, SshTarget } from "@1outres/dsh-bot-core"
import type { PinHostKey, TargetSite } from "./site"
import {
  authorizedKeysLine,
  hostKeyLine,
  parseKeyscan,
  parseSshTarget,
  type SetupSshPaths,
  setupKnownHostsText,
  setupSshConfigText,
} from "./ssh-files"
import type { SetupFiles } from "./store"

export interface SetupSshDeps {
  readonly paths: SetupSshPaths
  readonly files: Pick<SetupFiles, "read" | "write" | "mkdir" | "remove">
  readonly comment: string
  keygen(path: string, comment: string): Promise<void>
  keyscan(target: SshTarget, signal?: AbortSignal): Promise<string>
  readonly pin: PinHostKey
}

export type SshSite = Extract<TargetSite, { kind: "ssh" }>

export interface SetupSsh {
  identity(): Promise<SshIdentityView>
  publicKey(): Promise<string | undefined>
  scan(target: SshTarget, signal?: AbortSignal): Promise<HostKeyScan>
  resolve(target: SshTarget, key: PinnedHostKey, known: readonly SshSite[]): SshSite
  point(site: SshSite): Promise<void>
  removeLocal(): Promise<SshIdentityView>
}

const targetKey = (target: SshTarget) => `${target.user}@${target.host}:${target.port}`

export function createSetupSsh(deps: SetupSshDeps): SetupSsh {
  const { paths, files } = deps
  const scanned = new Map<string, readonly string[]>()

  async function publicKey(): Promise<string | undefined> {
    const [key, secret] = await Promise.all([
      files.read(paths.publicKey),
      files.read(paths.identity),
    ])
    return key === undefined || secret === undefined ? undefined : key.trim()
  }

  const viewOf = (key: string): SshIdentityView => {
    const line = authorizedKeysLine(key)
    return { state: "present", authorizedKeysLine: line, fingerprint: deps.pin(key).fingerprint }
  }

  const matches = (line: string, key: PinnedHostKey) => {
    const pinned = deps.pin(line)
    return pinned.type === key.type && pinned.fingerprint === key.fingerprint
  }

  return {
    publicKey,
    async identity() {
      const existing = await publicKey()
      if (existing !== undefined) return viewOf(existing)
      await files.mkdir(paths.dir, 0o700)
      await files.remove(paths.identity)
      await files.remove(paths.publicKey)
      await deps.keygen(paths.identity, deps.comment)
      const created = await publicKey()
      if (created === undefined) throw new Error(`ssh-keygen did not write ${paths.identity}`)
      return viewOf(created)
    },
    async scan(raw, signal) {
      const target = parseSshTarget(raw)
      const lines = parseKeyscan(await deps.keyscan(target, signal)).map((key) => key.line)
      if (lines.length === 0)
        throw new Error(`${target.host}:${target.port} offered no SSH host key`)
      scanned.set(targetKey(target), lines)
      return { target, keys: lines.map(deps.pin) }
    },
    resolve(raw, key, known) {
      const target = parseSshTarget(raw)
      const candidates = [
        ...(scanned.get(targetKey(target)) ?? []),
        ...known
          .filter((site) => targetKey(site) === targetKey(target))
          .map((site) => site.hostKey),
      ]
      const line = candidates.find((candidate) => matches(candidate, key))
      if (line === undefined) {
        throw new Error(
          `the host key ${key.fingerprint} of ${target.host}:${target.port} is not one this installation scanned; scan the host key again`,
        )
      }
      return { kind: "ssh", ...target, hostKey: hostKeyLine(line) }
    },
    async point(site) {
      const type = hostKeyLine(site.hostKey).split(" ")[0] as string
      await files.mkdir(paths.dir, 0o700)
      await files.write(paths.knownHosts, setupKnownHostsText(site.hostKey), 0o600)
      await files.write(paths.config, setupSshConfigText(paths, site, type), 0o600)
    },
    async removeLocal() {
      await files.remove(paths.identity)
      await files.remove(paths.publicKey)
      return { state: "absent" }
    },
  }
}
