import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BotEnvironment } from "@1outres/dsh-bot-core"
import { Context, Service } from "@deepseek-ai/cordis"
import { describe, expect, it } from "vitest"
import * as vm from "../src/index"

class FakeBot extends Service {
  registered: BotEnvironment[] = []
  constructor(ctx: Context) {
    super(ctx, "bot")
  }
  registerEnvironment(environment: BotEnvironment) {
    this.registered.push(environment)
    return () => {
      this.registered = this.registered.filter((entry) => entry !== environment)
    }
  }
}

describe("@1outres/dsh-bot-vm", () => {
  it("registers the incus-vm environment while the row is active", async () => {
    const root = new Context()
    await root.plugin(FakeBot)
    const bot = root.get("bot") as FakeBot
    const stateDir = mkdtempSync(join(tmpdir(), "bot-vm-state-"))
    const fiber = root.plugin(vm, vm.Config({ stateDir } as never))
    await fiber
    expect(bot.registered.map((environment) => environment.id)).toEqual(["incus-vm"])
    expect(bot.registered[0]?.workspace).toBe("/home/bot/workspace")
    const rows = bot.registered[0]?.rows({ id: "abc", name: "A" }) ?? []
    expect(rows[0]?.config).toMatchObject({
      host: "dsh-bot-abc",
      workspace: "/home/bot/workspace",
      helper: "/opt/dsh-ssh-helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js",
      helperHash: vm.HELPER_SHA256,
    })
    await fiber.dispose()
    expect(bot.registered).toEqual([])
    rmSync(stateDir, { recursive: true, force: true })
  })

  it("stores a new random owner once", () => {
    const base = mkdtempSync(join(tmpdir(), "owner-"))
    try {
      const state = join(base, "state")
      const owner = vm.ownerOf(state)
      expect(owner).toMatch(/^[0-9a-f]{32}$/)
      expect(readFileSync(join(state, "owner"), "utf8")).toBe(`${owner}\n`)
      expect(statSync(join(state, "owner")).mode & 0o777).toBe(0o600)
      expect(vm.ownerOf(state)).toBe(owner)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("keeps the owner of an earlier version: the hash of the real state directory", () => {
    const base = mkdtempSync(join(tmpdir(), "owner-"))
    try {
      mkdirSync(join(base, "real", "state", "bots"), { recursive: true })
      symlinkSync(join(base, "real"), join(base, "link"))
      const earlier = vm.earlierOwnerOf(join(base, "real", "state"))
      expect(earlier).toMatch(/^[0-9a-f]{16}$/)
      expect(vm.ownerOf(join(base, "link", "state"))).toBe(earlier)
      expect(readFileSync(join(base, "real", "state", "owner"), "utf8")).toBe(`${earlier}\n`)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("refuses an owner file it cannot read as an id", () => {
    const base = mkdtempSync(join(tmpdir(), "owner-"))
    try {
      writeFileSync(join(base, "owner"), "not hex\n")
      expect(() => vm.ownerOf(base)).toThrow("owner file")
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it("expands ~ and proxies SSH through its own vsock-proxy.js on this Node", () => {
    const settings = vm.settingsOf(vm.Config({} as never), "0".repeat(16))
    expect(settings.stateDir.endsWith("/.dsh/bots-vm")).toBe(true)
    expect(settings.stateDir.startsWith("/")).toBe(true)
    expect(settings.vsockProxy.node).toBe(process.execPath)
    expect(settings.vsockProxy.script.endsWith("/vsock-proxy.js")).toBe(true)
    expect(settings.vsockProxy).toMatchObject({
      socket: "/var/lib/incus/unix.socket",
      project: "default",
    })
    expect([settings.socat, settings.guestRipgrep]).toEqual(["socat", "/usr/bin/rg"])
  })

  it("shares from ~/.dsh/bots as the DSH user, guest uid 1001", () => {
    const settings = vm.settingsOf(vm.Config({} as never), "0".repeat(16))
    expect(settings.hostRoot.endsWith("/.dsh/bots")).toBe(true)
    expect(settings.hostRoot.startsWith("/")).toBe(true)
    expect(settings.hostUid).toBe(process.getuid?.())
    expect(settings.hostGid).toBe(process.getgid?.())
    expect([settings.guestUid, settings.guestGid]).toEqual([1001, 1001])
  })

  it("finds commands on the PATH and refuses missing ones", async () => {
    await expect(vm.which("sh")).resolves.toMatch(/^\/.*\/sh$/)
    await expect(vm.which("dsh-bot-vm-no-such-command")).rejects.toThrow(
      "is not on the PATH of DSH",
    )
    await expect(vm.which("/nonexistent/socat")).rejects.toThrow("is not an executable file")
  })

  it("finds the mount a path lies on in mountinfo", () => {
    const info = [
      "26 1 8:2 / / rw,relatime shared:1 - ext4 /dev/sda2 rw",
      "40 26 0:30 / /home/u/.dsh/bots-vm rw shared:2 - tmpfs t rw",
      "41 26 8:2 /home/u/.dsh/bots /home/u/.dsh/bots rw,nosuid,nodev,relatime,nosymfollow shared:1 - ext4 /dev/sda2 rw",
      "42 26 8:2 /x /home/u/with\\040space rw,nosuid shared:1 - ext4 /dev/sda2 rw",
      "",
    ].join("\n")
    expect(vm.mountFromInfo(info, "/home/u/.dsh/bots/a/workspace")).toEqual({
      target: "/home/u/.dsh/bots",
      options: ["rw", "nosuid", "nodev", "relatime", "nosymfollow"],
    })
    expect(vm.mountFromInfo(info, "/home/u/.dsh/botsx").target).toBe("/")
    expect(vm.mountFromInfo(info, "/home/u/with space/a").options).toEqual(["rw", "nosuid"])
  })
})
