import type { BotConnectorContext, BotConnectorPreparation } from "@1outres/dsh-bot-core"
import { type Resolution, resolutionOf } from "../../shared/resolution"
import { connectAgent } from "../agent/connect"
import type { RpcClientDeps } from "../agent/rpc"
import { readVmUser, run } from "./commands"
import {
  type InstalledFile,
  installedFiles,
  REPLACED_DIRECTORIES,
  type VmSourceFile,
} from "./files"
import {
  ALL_UNITS,
  DISPLAY,
  DIVERTED_FILES,
  displayEnv,
  ENABLED_UNITS,
  RESTARTED_BY,
  stagingDir,
  UNITS,
  userManagerEnv,
  type VmUser,
} from "./layout"
import { DESKTOP_PACKAGES } from "./packages"

export interface DesktopPreparationDeps extends RpcClientDeps {
  readonly sources: readonly VmSourceFile[]
}

const APT_TIMEOUT_MS = 30 * 60_000
const SUDO = ["sudo", "-n"] as const
const APT = [
  ...SUDO,
  "env",
  "DEBIAN_FRONTEND=noninteractive",
  "apt-get",
  "-q",
  "-o",
  "DPkg::Lock::Timeout=600",
]

const INSTALL = [
  "set -eu",
  "stage=$1; shift",
  "n=$1; shift",
  'while [ "$n" -gt 0 ]; do rm -rf -- "$1"; shift; n=$((n - 1)); done',
  "n=$1; shift",
  'while [ "$n" -gt 0 ]; do dpkg-divert --quiet --local --rename --divert "$1.dsh-real" --add "$1"; shift; n=$((n - 1)); done',
  'while [ $# -gt 0 ]; do install -D -o root -g root -m "$2" -- "$stage/$1" "$3"; shift 3; done',
].join("\n")

// biome-ignore lint/suspicious/noTemplateCurlyInString: -
const DPKG_FORMAT = "-f=${Package} ${db:Status-Status}\n"

export function missingPackages(dpkgStatus: string): readonly string[] {
  const installed = new Set(
    dpkgStatus
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(([, status]) => status === "installed")
      .map(([name]) => name),
  )
  return DESKTOP_PACKAGES.filter((name) => !installed.has(name))
}

export function displaySize(xdpyinfo: string): Resolution {
  const match = /dimensions:\s+([0-9]+)x([0-9]+) pixels/.exec(xdpyinfo)
  if (match === null) throw new Error("xdpyinfo did not report the display's size")
  return { width: Number(match[1]), height: Number(match[2]) }
}

const sameSize = (a: Resolution, b: Resolution) => a.width === b.width && a.height === b.height

export function createDesktopPreparation(deps: DesktopPreparationDeps): BotConnectorPreparation {
  const userCtl = (
    context: BotConnectorContext,
    user: VmUser,
    args: readonly string[],
    accept?: readonly number[],
  ) =>
    run(context.environment, ["systemctl", "--user", ...args], {
      signal: context.signal,
      env: userManagerEnv(user),
      timeoutMs: 120_000,
      ...(accept === undefined ? {} : { accept }),
    })

  const readDisplay = async (context: BotConnectorContext, user: VmUser) => {
    const result = await run(context.environment, ["xdpyinfo", "-display", DISPLAY], {
      signal: context.signal,
      env: displayEnv(user),
      timeoutMs: 30_000,
    })
    return displaySize(result.stdout)
  }

  const installPackages = async (
    context: BotConnectorContext,
    progress: (step: string) => void,
  ) => {
    const status = await run(
      context.environment,
      ["dpkg-query", "-W", DPKG_FORMAT, ...DESKTOP_PACKAGES],
      { signal: context.signal, accept: [0, 1] },
    )
    const missing = missingPackages(status.stdout)
    if (missing.length === 0) return
    progress(`installing packages (${missing.length} missing)`)
    await run(context.environment, [...APT, "update"], {
      signal: context.signal,
      timeoutMs: APT_TIMEOUT_MS,
    })
    await run(
      context.environment,
      [...APT, "install", "-y", "--no-install-recommends", ...DESKTOP_PACKAGES],
      { signal: context.signal, timeoutMs: APT_TIMEOUT_MS },
    )
  }

  const changedUnits = async (context: BotConnectorContext, files: readonly InstalledFile[]) => {
    const changed = new Set<string>()
    for (const [unit, targets] of Object.entries(RESTARTED_BY)) {
      for (const target of targets) {
        const file = files.find((candidate) => candidate.target === target)
        if (file === undefined) throw new Error(`vm/ has no ${target}`)
        const current = await run(context.environment, ["cat", "--", target], {
          signal: context.signal,
          accept: [0, 1],
        })
        if (current.exitCode !== 0 || current.stdout !== new TextDecoder().decode(file.data)) {
          changed.add(unit)
        }
      }
    }
    return changed
  }

  const installFiles = async (
    context: BotConnectorContext,
    user: VmUser,
    files: readonly InstalledFile[],
  ) => {
    const stage = stagingDir(user)
    await run(context.environment, ["rm", "-rf", "--", stage], { signal: context.signal })
    await run(context.environment, ["mkdir", "-p", "-m", "0700", "--", stage], {
      signal: context.signal,
    })
    for (const [index, file] of files.entries()) {
      await context.environment.writeFile(`${stage}/${index}`, file.data, {
        mode: 0o600,
        signal: context.signal,
      })
    }
    await run(
      context.environment,
      [
        ...SUDO,
        "sh",
        "-c",
        INSTALL,
        "install-desktop",
        stage,
        String(REPLACED_DIRECTORIES.length),
        ...REPLACED_DIRECTORIES,
        String(DIVERTED_FILES.length),
        ...DIVERTED_FILES,
        ...files.flatMap((file, index) => [String(index), file.mode.toString(8), file.target]),
      ],
      { signal: context.signal },
    )
    await run(context.environment, ["rm", "-rf", "--", stage], { signal: context.signal })
  }

  const startSession = async (
    context: BotConnectorContext,
    user: VmUser,
    resolution: Resolution,
    changed: ReadonlySet<string>,
  ) => {
    await run(context.environment, [...SUDO, "loginctl", "enable-linger", user.name], {
      signal: context.signal,
    })
    await run(context.environment, [...SUDO, "systemctl", "start", `user@${user.uid}.service`], {
      signal: context.signal,
    })
    await userCtl(context, user, ["daemon-reload"])
    await userCtl(context, user, ["enable", ...ENABLED_UNITS])
    const active = async (unit: string) =>
      (await userCtl(context, user, ["is-active", "--quiet", unit], [0, 3, 4])).exitCode === 0
    if (
      (await active(UNITS.xvnc)) &&
      (changed.has(UNITS.xvnc) || !sameSize(await readDisplay(context, user), resolution))
    ) {
      await userCtl(context, user, ["restart", UNITS.xvnc])
    }
    await userCtl(context, user, ["start", UNITS.session, UNITS.im])
    await userCtl(context, user, ["restart", UNITS.agent])
    if (changed.has(UNITS.chrome) && (await active(UNITS.chrome))) {
      await userCtl(context, user, ["restart", UNITS.chrome])
    }
    await userCtl(context, user, ["start", UNITS.chrome])
  }

  const check = async (context: BotConnectorContext, user: VmUser, resolution: Resolution) => {
    const size = await readDisplay(context, user)
    if (!sameSize(size, resolution)) {
      throw new Error(
        `the display is ${size.width}x${size.height}, not ${resolution.width}x${resolution.height}`,
      )
    }
    const connection = await connectAgent(context.environment, user, context.signal, deps)
    connection.close()
  }

  return {
    async prepare(context, progress) {
      const resolution = resolutionOf(context.settings)
      progress("reading the bot's account")
      const user = await readVmUser(context.environment, context.signal)
      progress("installing the desktop agent, services and package sources")
      const files = installedFiles(deps.sources, resolution)
      const changed = await changedUnits(context, files)
      await installFiles(context, user, files)
      progress("checking packages")
      await installPackages(context, progress)
      progress("starting the desktop")
      await startSession(context, user, resolution, changed)
      progress("checking the display and the agent")
      await check(context, user, resolution)
    },
    async unprepare(context) {
      const user = await readVmUser(context.environment, context.signal)
      await userCtl(context, user, ["disable", "--now", ...ALL_UNITS])
    },
  }
}
