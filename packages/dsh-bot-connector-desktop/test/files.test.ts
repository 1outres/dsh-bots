import { describe, expect, it } from "vitest"
import { installedFiles, placementOf } from "../src/host/vm/files"
import { readVmSources } from "../src/index"

describe("the files put into the bot's environment", () => {
  it("places every file of vm/", async () => {
    const sources = await readVmSources()
    expect(sources.length).toBeGreaterThan(10)
    for (const source of sources) expect(() => placementOf(source.path)).not.toThrow()
  })

  it("installs the agent, the units and the configuration where the units expect them", async () => {
    const files = installedFiles(await readVmSources(), { width: 1280, height: 800 })
    const targets = new Map(files.map((file) => [file.target, file]))
    expect(targets.get("/usr/local/lib/dsh-desktop/agent/run.py")?.mode).toBe(0o644)
    expect(
      targets.get("/usr/local/lib/dsh-desktop/agent/dsh_desktop_agent/service.py"),
    ).toBeDefined()
    expect(targets.get("/usr/local/lib/dsh-desktop/xvnc-start")?.mode).toBe(0o755)
    expect(targets.get("/etc/systemd/user/dsh-desktop-agent.service")).toBeDefined()
    expect(targets.get("/usr/bin/google-chrome-stable")?.mode).toBe(0o755)
    expect(targets.get("/usr/local/lib/dsh-desktop/chrome-run")?.mode).toBe(0o755)
    expect(targets.get("/etc/apt/sources.list.d/dsh-google-chrome.sources")).toBeDefined()
    expect(targets.get("/etc/apt/keyrings/dsh-google-chrome.asc")).toBeDefined()
    expect(targets.get("/usr/lib/libreoffice/share/registry/dsh-desktop.xcd")).toBeDefined()
    const display = targets.get("/etc/dsh-desktop/display.env")
    expect(new TextDecoder().decode(display?.data)).toBe("DSH_DESKTOP_GEOMETRY=1280x800\n")
  })

  it("keeps the X server on a Unix socket behind an X cookie", async () => {
    const sources = await readVmSources()
    const text = (path: string) =>
      new TextDecoder().decode(sources.find((source) => source.path === path)?.data)
    const start = text("bin/xvnc-start")
    expect(start).toContain("-rfbport -1")
    expect(start).toContain("-rfbunixmode 0600")
    expect(start).toContain('-auth "$auth"')
    expect(start).toContain("-nolisten tcp")
    for (const unit of ["dsh-desktop-session", "dsh-desktop-agent", "dsh-desktop-im"]) {
      expect(text(`systemd/${unit}.service`)).toContain("XAUTHORITY=%t/dsh-desktop/Xauthority")
    }
  })

  it("starts one Chrome with its own profile, DevTools on loopback and accessibility, whichever way it is launched", async () => {
    const sources = await readVmSources()
    const text = (path: string) =>
      new TextDecoder().decode(sources.find((source) => source.path === path)?.data)
    const run = text("bin/chrome-run")
    expect(run).toContain('--user-data-dir="$HOME/.local/share/dsh-desktop/chrome"')
    expect(run).toContain("--remote-debugging-port=9222")
    expect(run).toContain("--force-renderer-accessibility")
    expect(run).not.toContain("--remote-debugging-address")
    expect(text("bin/google-chrome-stable")).toContain(
      "systemctl --user start dsh-desktop-chrome.service",
    )
    const unit = text("systemd/dsh-desktop-chrome.service")
    expect(unit).toContain("ExecStart=/usr/local/lib/dsh-desktop/chrome-run")
    expect(unit).toContain("ExecStartPost=/usr/local/lib/dsh-desktop/chrome-ready")
    expect(unit).toContain("Restart=always")
    expect(text("apt/google-chrome.sources")).toContain(
      "Signed-By: /etc/apt/keyrings/dsh-google-chrome.asc",
    )
  })

  it("refuses a file without a place", () => {
    expect(() => placementOf("notes.txt")).toThrow(/no place/)
    expect(() => placementOf("agent/dsh_desktop_agent/sub/x.py")).toThrow(/no place/)
  })
})
