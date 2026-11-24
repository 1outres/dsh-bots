import type { BotEnvironmentCommand } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { DESKTOP_PACKAGES } from "../src/host/vm/packages"
import { createDesktopPreparation, displaySize, missingPackages } from "../src/host/vm/preparation"
import { readVmSources } from "../src/index"
import { recordingEnvironment } from "./support"

const ACCOUNT = "1001\nbot\n/home/bot\n"
const sourceText = async (path: string) =>
  new TextDecoder().decode((await readVmSources()).find((file) => file.path === path)?.data)
const XVNC_START = await sourceText("bin/xvnc-start")
const CHROME_RUN = await sourceText("bin/chrome-run")
const CHROME_UNIT = await sourceText("systemd/dsh-desktop-chrome.service")
const ALL_INSTALLED = DESKTOP_PACKAGES.map((name) => `${name} installed`).join("\n")

function line(command: BotEnvironmentCommand): string {
  return command.argv.join(" ")
}

/** A VM where everything is installed and Xvnc runs at \`size\`. */
function vm(options: {
  readonly dpkg?: string
  readonly size?: string
  readonly xvncActive?: boolean
  /** The installed xvnc-start; default: this package's. */
  readonly server?: string
  /** The installed chrome-run; default: this package's. */
  readonly chrome?: string
}) {
  let size = options.size ?? "1280x1024"
  return recordingEnvironment((command) => {
    const text = line(command)
    if (text.startsWith("sh -c id -u")) return { stdoutText: ACCOUNT }
    if (text.startsWith("dpkg-query"))
      return {
        stdoutText: options.dpkg ?? ALL_INSTALLED,
        exitCode: options.dpkg === undefined ? 0 : 1,
      }
    if (text.startsWith("xdpyinfo"))
      return { stdoutText: `  dimensions:    ${size} pixels (339x271 millimeters)\n` }
    if (text.includes("is-active")) return { exitCode: options.xvncActive === false ? 3 : 0 }
    if (text === "cat -- /usr/local/lib/dsh-desktop/xvnc-start")
      return { stdoutText: options.server ?? XVNC_START }
    if (text === "cat -- /usr/local/lib/dsh-desktop/chrome-run")
      return { stdoutText: options.chrome ?? CHROME_RUN }
    if (text === "cat -- /etc/systemd/user/dsh-desktop-chrome.service")
      return { stdoutText: CHROME_UNIT }
    if (text.includes("restart dsh-desktop-xvnc")) size = "1280x800"
    return {}
  })
}

const context = (environment: ReturnType<typeof vm>["environment"], resolution = "1280x1024") => ({
  bot: { id: "b1", name: "Bot" },
  settings: { resolution },
  environment,
  signal: new AbortController().signal,
})

describe("what the VM reports", () => {
  it("names the packages dpkg does not have installed", () => {
    const status = ALL_INSTALLED.replace(
      "google-chrome-stable installed",
      "google-chrome-stable not-installed",
    ).replace("socat installed\n", "")
    expect(missingPackages(`${status}\n`)).toEqual(["google-chrome-stable"])
    expect(missingPackages(ALL_INSTALLED)).toEqual([])
  })

  it("reads the display's size from xdpyinfo", () => {
    expect(displaySize("  dimensions:    1280x800 pixels (338x211 millimeters)")).toEqual({
      width: 1280,
      height: 800,
    })
    expect(() => displaySize("nothing")).toThrow()
  })
})

describe("preparing the desktop", () => {
  const prepare = async (machine: ReturnType<typeof vm>, resolution?: string) => {
    const preparation = createDesktopPreparation({
      sources: await readVmSources(),
      deadline: (ms) => AbortSignal.timeout(ms),
    })
    const steps: string[] = []
    const run = preparation.prepare(context(machine.environment, resolution), (step) =>
      steps.push(step),
    )
    return { run, steps }
  }

  it("installs nothing when the packages are there, then files, services and checks, in order", async () => {
    const machine = vm({})
    const { run, steps } = await prepare(machine)
    await expect(run).rejects.toThrow(/spawn is answered by the test/)
    const commands = machine.commands.map(line)
    expect(commands.some((command) => command.includes("apt-get"))).toBe(false)
    const install = commands.find((command) => command.startsWith("sudo -n sh -c"))
    expect(install).toContain("/usr/local/lib/dsh-desktop/agent/dsh_desktop_agent/service.py")
    expect(install).toContain("/etc/dsh-desktop/display.env")
    expect(machine.files.size).toBeGreaterThan(10)
    expect(
      [...machine.files.keys()].every((path) =>
        path.startsWith("/home/bot/.cache/dsh-desktop/staging/"),
      ),
    ).toBe(true)
    expect(install).toContain("dpkg-divert")
    expect(install).toContain("1 /usr/bin/google-chrome-stable")
    const order = [
      install,
      "dpkg-query",
      "sudo -n loginctl enable-linger bot",
      "sudo -n systemctl start user@1001.service",
      "systemctl --user daemon-reload",
      "systemctl --user enable dsh-desktop-session.service dsh-desktop-agent.service dsh-desktop-im.service dsh-desktop-chrome.service",
      "systemctl --user start dsh-desktop-session.service dsh-desktop-im.service",
      "systemctl --user restart dsh-desktop-agent.service",
      "systemctl --user start dsh-desktop-chrome.service",
    ].map((start) => commands.findIndex((command) => command.startsWith(start ?? "")))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(commands.some((command) => command.includes("restart dsh-desktop-xvnc"))).toBe(false)
    expect(commands.some((command) => command.includes("restart dsh-desktop-chrome"))).toBe(false)
    const user = machine.commands.find(
      (command) => line(command) === "systemctl --user daemon-reload",
    )
    expect(user?.env).toEqual({
      XDG_RUNTIME_DIR: "/run/user/1001",
      DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1001/bus",
    })
    expect(steps).toEqual([
      "reading the bot's account",
      "installing the desktop agent, services and package sources",
      "checking packages",
      "starting the desktop",
      "checking the display and the agent",
    ])
  })

  it("installs the whole pinned list when one is missing", async () => {
    const machine = vm({ dpkg: ALL_INSTALLED.replace("xclip installed", "") })
    const { run, steps } = await prepare(machine)
    await expect(run).rejects.toThrow()
    const apt = machine.commands.map(line).filter((command) => command.includes("apt-get"))
    expect(apt[0]).toContain("apt-get -q -o DPkg::Lock::Timeout=600 update")
    expect(apt[1]).toContain(`install -y --no-install-recommends ${DESKTOP_PACKAGES.join(" ")}`)
    expect(steps).toContain("installing packages (1 missing)")
  })

  it("restarts the X server when it runs at another size", async () => {
    const machine = vm({ size: "1280x1024" })
    const { run } = await prepare(machine, "1280x800")
    await expect(run).rejects.toThrow(/spawn/)
    expect(machine.commands.map(line)).toContain(
      "systemctl --user restart dsh-desktop-xvnc.service",
    )
    expect(new TextDecoder().decode([...machine.files.values()].at(-1))).toBe(
      "DSH_DESKTOP_GEOMETRY=1280x800\n",
    )
  })

  it("restarts the X server when the way it starts changed", async () => {
    const machine = vm({ server: XVNC_START.replace(" -FrameRate 24", "") })
    const { run } = await prepare(machine)
    await expect(run).rejects.toThrow()
    expect(machine.commands.map(line)).toContain(
      "systemctl --user restart dsh-desktop-xvnc.service",
    )
  })

  it("restarts Chrome when the way it starts changed", async () => {
    const machine = vm({ chrome: CHROME_RUN.replace(" --no-first-run", "") })
    const { run } = await prepare(machine)
    await expect(run).rejects.toThrow()
    const commands = machine.commands.map(line)
    expect(commands).toContain("systemctl --user restart dsh-desktop-chrome.service")
    expect(commands).not.toContain("systemctl --user restart dsh-desktop-xvnc.service")
  })

  it("stops and disables the services when the connector is turned off", async () => {
    const machine = vm({})
    const preparation = createDesktopPreparation({
      sources: [],
      deadline: (ms) => AbortSignal.timeout(ms),
    })
    await preparation.unprepare?.(context(machine.environment))
    expect(machine.commands.map(line)).toContain(
      "systemctl --user disable --now dsh-desktop-chrome.service dsh-desktop-agent.service dsh-desktop-im.service dsh-desktop-session.service dsh-desktop-xvnc.service",
    )
  })
})
