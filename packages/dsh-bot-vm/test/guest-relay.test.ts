import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import type { GuestChannel } from "../src/host/backend/contract"
import type { ByteChannel } from "../src/host/backend/incus/client"
import { proxyCommandOf } from "../src/host/guest-transport"
import { runGuestProxy } from "../src/node/guest-proxy-client"
import { startGuestRelay } from "../src/node/guest-relay"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function echoSession() {
  const queue: Uint8Array[] = []
  let ended = false
  let wake: (() => void) | undefined
  let destroyed = false
  const channel = (iterate: () => AsyncGenerator<Uint8Array>): ByteChannel => ({
    [Symbol.asyncIterator]: iterate,
    write: async (data) => {
      queue.push(new TextEncoder().encode(new TextDecoder().decode(data).toUpperCase()))
      wake?.()
    },
    end: async () => {
      ended = true
      wake?.()
    },
    destroy: () => {
      destroyed = true
    },
  })
  const stdin = channel(async function* () {})
  const stdout = channel(async function* () {
    for (;;) {
      const next = queue.shift()
      if (next !== undefined) yield next
      else if (ended) return
      else await new Promise<void>((resolve) => (wake = resolve))
    }
  })
  const stderr = channel(async function* () {
    yield new TextEncoder().encode("sshd: diagnostics\n")
  })
  const session: GuestChannel = {
    input: stdin,
    output: stdout,
    diagnostics: stderr,
    close: () => {
      destroyed = true
    },
  }
  return { session, destroyed: () => destroyed }
}

async function relayIn(open: (instance: string) => Promise<GuestChannel>) {
  const dir = mkdtempSync(join(tmpdir(), "relay-"))
  dirs.push(dir)
  const socket = join(dir, "run", "guest.sock")
  const logs: string[] = []
  const relay = await startGuestRelay({
    socket,
    open,
    log: (line) => logs.push(line),
    requestTimeoutMs: 2_000,
  })
  return { relay, socket, logs, dir }
}

function io(input: string) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const out: Buffer[] = []
  const err: Buffer[] = []
  stdout.on("data", (chunk: Buffer) => out.push(chunk))
  stderr.on("data", (chunk: Buffer) => err.push(chunk))
  stdin.end(input)
  return {
    streams: { stdin, stdout, stderr },
    out: () => Buffer.concat(out).toString(),
    err: () => Buffer.concat(err).toString(),
  }
}

describe("guest relay", () => {
  it("carries the proxy's bytes to the guest command and back, in a private directory", async () => {
    const opened: string[] = []
    const echo = echoSession()
    const { relay, socket, logs, dir } = await relayIn(async (instance) => {
      opened.push(instance)
      return echo.session
    })
    expect(statSync(join(dir, "run")).mode & 0o777).toBe(0o700)
    const proxy = io("hello sshd")
    expect(await runGuestProxy(socket, "dsh-bot-1a2b", proxy.streams)).toBe(0)
    expect(proxy.out()).toBe("HELLO SSHD")
    expect(opened).toEqual(["dsh-bot-1a2b"])
    expect(logs).toContain("guest relay: dsh-bot-1a2b: sshd: diagnostics")
    expect(echo.destroyed()).toBe(true)
    await relay.close()
  })

  it("reports a refusal on the proxy's stderr and exits 255", async () => {
    const { relay, socket } = await relayIn(async () => {
      throw new Error('"x" is not a bot VM of this installation')
    })
    const proxy = io("")
    expect(await runGuestProxy(socket, "dsh-bot-x", proxy.streams)).toBe(255)
    expect(proxy.err()).toBe('dsh-bot-vm guest-proxy: "x" is not a bot VM of this installation\n')
    await relay.close()
  })

  it("tells ssh when DSH is not running", async () => {
    const proxy = io("")
    expect(await runGuestProxy("/nonexistent/guest.sock", "dsh-bot-x", proxy.streams)).toBe(255)
    expect(proxy.err()).toContain("is DSH running?")
  })

  it("replaces a stale socket, but not one another process serves", async () => {
    const first = await relayIn(async () => echoSession().session)
    await expect(
      startGuestRelay({
        socket: first.socket,
        open: async () => echoSession().session,
        log: () => {},
        requestTimeoutMs: 1_000,
      }),
    ).rejects.toThrow("another process relays")
    await first.relay.close()
    const { writeFileSync } = await import("node:fs")
    writeFileSync(first.socket, "")
    const again = await startGuestRelay({
      socket: first.socket,
      open: async () => echoSession().session,
      log: () => {},
      requestTimeoutMs: 1_000,
    })
    await again.close()
  })
})

describe("proxy command", () => {
  it("names the relay and the instance, quoted for the shell and ssh's % tokens", () => {
    expect(
      proxyCommandOf(
        {
          node: "/usr/bin/node",
          script: "/opt/my lib/guest-proxy.js",
          socket: "/s/50%/guest.sock",
        },
        "dsh-bot-1",
      ),
    ).toBe("/usr/bin/node '/opt/my lib/guest-proxy.js' '/s/50%%/guest.sock' dsh-bot-1")
    expect(() => proxyCommandOf({ node: "/n", script: "/s", socket: "/k" }, "a b")).toThrow(
      "not an Incus instance name",
    )
  })
})
