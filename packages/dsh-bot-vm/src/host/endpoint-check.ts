/**
 * Whether an endpoint and project can run bot VMs (docs/specs/incus-endpoint.md
 * §3.4, §5.1). It lists everything missing with how to fix it; the caller
 * stops while anything is (fail closed). The project's `user.dsh-bots.*` keys
 * name the pool and network its administrator allowed.
 */
import type { IncusClient, IncusDevice } from "./incus"

export type EndpointProblemCode =
  | "project-default"
  | "unreachable"
  | "untrusted"
  | "incus-too-old"
  | "no-vm-driver"
  | "project-missing"
  | "project-unrestricted"
  | "pool-undeclared"
  | "pool-unusable"
  | "network-undeclared"
  | "network-unusable"
  | "profile-foreign-device"

export interface EndpointProblem {
  readonly code: EndpointProblemCode
  readonly message: string
  readonly fix: string
}

/** What the project's administrator declared for dsh-bots. */
export interface ProjectDeclaration {
  readonly pool: string
  readonly network: string
  /** The egress ACL the administrator says the network applies; undefined when not declared. */
  readonly egressAcl: string | undefined
}

export type EndpointCheck =
  | { readonly ok: true; readonly declaration: ProjectDeclaration }
  | { readonly ok: false; readonly problems: readonly EndpointProblem[] }

export const POOL_KEY = "user.dsh-bots.pool"
export const NETWORK_KEY = "user.dsh-bots.network"
export const EGRESS_ACL_KEY = "user.dsh-bots.egress-acl"
/** The oldest Incus whose restrictions docs/specs/incus-endpoint.md §6.1 was confirmed on. */
export const MIN_INCUS_VERSION = [6, 0, 4] as const

export interface CheckTarget {
  readonly incus: IncusClient
  readonly kind: "local" | "remote"
  readonly project: string
}

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

async function poolProblems(
  incus: IncusClient,
  project: string,
  config: Readonly<Record<string, string>>,
  pool: string | undefined,
  signal: AbortSignal | undefined,
): Promise<readonly EndpointProblem[]> {
  if (pool === undefined) {
    return [
      {
        code: "pool-undeclared",
        message: `the project "${project}" names no storage pool (${POOL_KEY})`,
        fix: `incus project set ${project} ${POOL_KEY}=<pool>`,
      },
    ]
  }
  if (config[`limits.disk.pool.${pool}`] === "0") {
    return [
      {
        code: "pool-unusable",
        message: `the project "${project}" may not use its storage pool "${pool}" (limits.disk.pool.${pool}=0)`,
        fix: `incus project set ${project} limits.disk.pool.${pool}=<size>`,
      },
    ]
  }
  try {
    await incus.poolSpace(pool, signal)
    return []
  } catch (error) {
    return [
      {
        code: "pool-unusable",
        message: `the storage pool "${pool}" cannot be used: ${messageOf(error)}`,
        fix: `create the pool "${pool}" or name an existing one in ${POOL_KEY}`,
      },
    ]
  }
}

async function networkProblems(
  incus: IncusClient,
  project: string,
  network: string | undefined,
  signal: AbortSignal | undefined,
): Promise<readonly EndpointProblem[]> {
  if (network === undefined) {
    return [
      {
        code: "network-undeclared",
        message: `the project "${project}" names no network (${NETWORK_KEY})`,
        fix: `incus project set ${project} ${NETWORK_KEY}=<network>`,
      },
    ]
  }
  const fix = `create it or allow it: incus project set ${project} restricted.networks.access=${network}`
  try {
    if (await incus.hasNetwork(network, signal)) return []
    return [
      {
        code: "network-unusable",
        message: `the project "${project}" cannot use the network "${network}"`,
        fix,
      },
    ]
  } catch (error) {
    return [
      {
        code: "network-unusable",
        message: `the network "${network}" cannot be read: ${messageOf(error)}`,
        fix,
      },
    ]
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Devices of a profile that name a pool or network other than the declared ones. */
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

export async function checkEndpoint(
  target: CheckTarget,
  signal?: AbortSignal,
): Promise<EndpointCheck> {
  const { incus, project } = target
  const projectFix =
    target.kind === "local"
      ? "prepare this machine as a VM host with dsh-bots' install.sh (DSH runs on this machine)"
      : "prepare the VM host with dsh-bots' install.sh, or have the Incus server's administrator run infra/incus/create-project.sh"
  if (project === "default") {
    return {
      ok: false,
      problems: [
        {
          code: "project-default",
          message: 'bot VMs never use the Incus project "default"',
          fix: `set incusProject to the project made for dsh-bots; ${projectFix}`,
        },
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
        {
          code: "unreachable",
          message: `the Incus API does not answer: ${messageOf(error)}`,
          fix:
            target.kind === "local"
              ? "check that Incus runs and that the DSH user is in the incus-admin group (install.sh adds it; restart DSH afterwards)"
              : "check that the VM host is up and its core.https_address is reachable from here",
        },
      ],
    }
  }
  if (server.auth !== "trusted") {
    return {
      ok: false,
      problems: [
        {
          code: "untrusted",
          message: "the Incus server does not trust this installation",
          fix: "pair with the VM host again using a new trust token",
        },
      ],
    }
  }
  const problems: EndpointProblem[] = []
  if (!versionAtLeast(server.serverVersion, MIN_INCUS_VERSION)) {
    problems.push({
      code: "incus-too-old",
      message: `Incus ${server.serverVersion || "(unknown version)"} is older than ${MIN_INCUS_VERSION.join(".")}`,
      fix: "upgrade Incus on the VM host",
    })
  }
  if (!server.drivers.includes("qemu")) {
    problems.push({
      code: "no-vm-driver",
      message: `the Incus server cannot run virtual machines (drivers: ${server.drivers.join(", ") || "none"})`,
      fix: "install Incus with QEMU support on a host with KVM",
    })
  }
  let config: Readonly<Record<string, string>>
  try {
    config = await incus.projectConfig(signal)
  } catch (error) {
    problems.push({
      code: "project-missing",
      message: `the Incus project "${project}" cannot be read: ${messageOf(error)}`,
      fix: projectFix,
    })
    return { ok: false, problems }
  }
  if (target.kind === "remote" && config.restricted !== "true") {
    problems.push({
      code: "project-unrestricted",
      message: `the Incus project "${project}" is not restricted`,
      fix: `incus project set ${project} restricted=true`,
    })
  }
  const pool = declared(config, POOL_KEY)
  const network = declared(config, NETWORK_KEY)
  problems.push(
    ...(await poolProblems(incus, project, config, pool, signal)),
    ...(await networkProblems(incus, project, network, signal)),
  )
  if (pool !== undefined && network !== undefined) {
    for (const profile of await incus.profiles(signal)) {
      const foreign = foreignDevices(profile.devices, { pool, network })
      if (foreign.length > 0) {
        problems.push({
          code: "profile-foreign-device",
          message: `the profile "${profile.name}" of the project has devices (${foreign.join(", ")}) the project may not use; Incus then refuses to create anything in it`,
          fix: `remove them: incus profile edit ${profile.name} --project ${project}`,
        })
      }
    }
  }
  if (problems.length > 0 || pool === undefined || network === undefined)
    return { ok: false, problems }
  return { ok: true, declaration: { pool, network, egressAcl: declared(config, EGRESS_ACL_KEY) } }
}
