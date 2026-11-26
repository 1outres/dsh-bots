import type { EnvironmentHostProblem, IncusProblemCode, ProblemFix } from "@1outres/dsh-bot-core"
import type { BackendCheck } from "../contract"
import type { IncusClient, IncusDevice } from "./client"

export const POOL_KEY = "user.dsh-bots.pool"
export const NETWORK_KEY = "user.dsh-bots.network"
export const EGRESS_ACL_KEY = "user.dsh-bots.egress-acl"
export const MIN_INCUS_VERSION = [6, 0, 4] as const

export type IncusOrigin = "managed" | "custom"

export interface IncusCheckTarget {
  readonly incus: IncusClient
  readonly project: string
  readonly origin: IncusOrigin
}

export interface IncusDeclaration {
  readonly pool: string
  readonly network: string
  readonly egressAcl: string | undefined
}

export type IncusCheck =
  | { readonly ok: true; readonly declaration: IncusDeclaration }
  | { readonly ok: false; readonly problems: readonly EnvironmentHostProblem[] }

const command = (text: string): ProblemFix => ({ kind: "command", text })
const sentence = (text: string): ProblemFix => ({ kind: "text", text })
const REPAIR: ProblemFix = { kind: "repair" }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function versionAtLeast(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => Number.isNaN(part))) return false
  for (let index = 0; index < minimum.length; index++) {
    const have = parts[index] ?? 0
    const want = minimum[index] as number
    if (have !== want) return have > want
  }
  return true
}

const declared = (config: Readonly<Record<string, string>>, key: string) => {
  const value = config[key]
  return value === undefined || value === "" ? undefined : value
}

function foreignDevices(
  devices: Readonly<Record<string, IncusDevice>>,
  declaration: { readonly pool: string; readonly network: string },
): readonly string[] {
  return Object.entries(devices).flatMap(([name, device]) => {
    if (device.type === "nic" && (device.network ?? device.parent) !== declaration.network)
      return [name]
    if (device.type === "disk" && device.pool !== undefined && device.pool !== declaration.pool)
      return [name]
    return []
  })
}

export async function checkIncus(
  target: IncusCheckTarget,
  signal?: AbortSignal,
): Promise<IncusCheck> {
  const { incus, project } = target
  const managed = target.origin === "managed"
  const problem = (
    code: IncusProblemCode,
    message: string,
    fix: ProblemFix,
  ): EnvironmentHostProblem => ({
    scope: "incus",
    code,
    message,
    fix: managed ? REPAIR : fix,
  })
  const administrator = command(`infra/incus/create-project.sh --project ${project}`)
  if (project === "default") {
    return {
      ok: false,
      problems: [
        problem(
          "project-default",
          'bot VMs never use the Incus project "default"',
          sentence("choose the VM host again with the project made for dsh-bots"),
        ),
      ],
    }
  }
  let server: Awaited<ReturnType<IncusClient["server"]>>
  try {
    server = await incus.server(signal)
  } catch (error) {
    return {
      ok: false,
      problems: [
        problem(
          "unreachable",
          `the Incus API does not answer: ${messageOf(error)}`,
          sentence(
            "check that the VM host is up and its core.https_address is reachable from here",
          ),
        ),
      ],
    }
  }
  if (server.auth !== "trusted") {
    return {
      ok: false,
      problems: [
        problem(
          "untrusted",
          "the Incus server does not trust this installation",
          sentence("pair with the VM host again using a new trust token"),
        ),
      ],
    }
  }
  const problems: EnvironmentHostProblem[] = []
  if (!versionAtLeast(server.serverVersion, MIN_INCUS_VERSION)) {
    problems.push(
      problem(
        "incus-too-old",
        `Incus ${server.serverVersion || "(unknown version)"} is older than ${MIN_INCUS_VERSION.join(".")}`,
        sentence("upgrade Incus on the VM host"),
      ),
    )
  }
  if (!server.drivers.includes("qemu")) {
    problems.push(
      problem(
        "no-vm-driver",
        `the Incus server cannot run virtual machines (drivers: ${server.drivers.join(", ") || "none"})`,
        sentence("install Incus with QEMU support on a host with KVM"),
      ),
    )
  }
  let config: Readonly<Record<string, string>>
  try {
    config = await incus.projectConfig(signal)
  } catch (error) {
    problems.push(
      problem(
        "project-missing",
        `the Incus project "${project}" cannot be read: ${messageOf(error)}`,
        administrator,
      ),
    )
    return { ok: false, problems }
  }
  if (config.restricted !== "true") {
    problems.push(
      problem(
        "project-unrestricted",
        `the Incus project "${project}" is not restricted`,
        command(`incus project set ${project} restricted=true`),
      ),
    )
  }
  const pool = declared(config, POOL_KEY)
  const network = declared(config, NETWORK_KEY)
  problems.push(
    ...(await poolProblems(target, config, pool, problem, signal)),
    ...(await networkProblems(target, network, problem, signal)),
  )
  if (pool !== undefined && network !== undefined) {
    for (const profile of await incus.profiles(signal)) {
      const foreign = foreignDevices(profile.devices, { pool, network })
      if (foreign.length > 0) {
        problems.push(
          problem(
            "profile-foreign-device",
            `the profile "${profile.name}" of the project has devices (${foreign.join(", ")}) the project may not use; Incus then refuses to create anything in it`,
            command(`incus profile edit ${profile.name} --project ${project}`),
          ),
        )
      }
    }
  }
  if (problems.length > 0 || pool === undefined || network === undefined)
    return { ok: false, problems }
  return { ok: true, declaration: { pool, network, egressAcl: declared(config, EGRESS_ACL_KEY) } }
}

type ProblemOf = (
  code: IncusProblemCode,
  message: string,
  fix: ProblemFix,
) => EnvironmentHostProblem

async function poolProblems(
  target: IncusCheckTarget,
  config: Readonly<Record<string, string>>,
  pool: string | undefined,
  problem: ProblemOf,
  signal: AbortSignal | undefined,
): Promise<readonly EnvironmentHostProblem[]> {
  const { project } = target
  if (pool === undefined) {
    return [
      problem(
        "pool-undeclared",
        `the project "${project}" names no storage pool (${POOL_KEY})`,
        command(`incus project set ${project} ${POOL_KEY}=<pool>`),
      ),
    ]
  }
  if (config[`limits.disk.pool.${pool}`] === "0") {
    return [
      problem(
        "pool-unusable",
        `the project "${project}" may not use its storage pool "${pool}" (limits.disk.pool.${pool}=0)`,
        command(`incus project set ${project} limits.disk.pool.${pool}=<size>`),
      ),
    ]
  }
  try {
    await target.incus.poolSpace(pool, signal)
    return []
  } catch (error) {
    return [
      problem(
        "pool-unusable",
        `the storage pool "${pool}" cannot be used: ${messageOf(error)}`,
        sentence(`create the pool "${pool}" or name an existing one in ${POOL_KEY}`),
      ),
    ]
  }
}

async function networkProblems(
  target: IncusCheckTarget,
  network: string | undefined,
  problem: ProblemOf,
  signal: AbortSignal | undefined,
): Promise<readonly EnvironmentHostProblem[]> {
  const { project } = target
  if (network === undefined) {
    return [
      problem(
        "network-undeclared",
        `the project "${project}" names no network (${NETWORK_KEY})`,
        command(`incus project set ${project} ${NETWORK_KEY}=<network>`),
      ),
    ]
  }
  const fix = command(`incus project set ${project} restricted.networks.access=${network}`)
  try {
    if (await target.incus.hasNetwork(network, signal)) return []
    return [
      problem(
        "network-unusable",
        `the project "${project}" cannot use the network "${network}"`,
        fix,
      ),
    ]
  } catch (error) {
    return [
      problem(
        "network-unusable",
        `the network "${network}" cannot be read: ${messageOf(error)}`,
        fix,
      ),
    ]
  }
}

export function backendCheckOf(check: IncusCheck): BackendCheck {
  if (!check.ok) return check
  const { pool, network, egressAcl } = check.declaration
  return {
    ok: true,
    declaration: {
      kind: "incus",
      pool,
      network,
      ...(egressAcl === undefined ? {} : { egressAcl }),
    },
  }
}
