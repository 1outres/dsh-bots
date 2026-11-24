import { describe, expect, it } from "vitest"
import type { IncusInstance } from "../src/host/incus"
import { parseProxyArgs, proxyCommandOf, socatArgs, vsockCidOf } from "../src/host/vsock"

const proxy = {
  node: "/usr/bin/node",
  script: "/p/lib/vsock-proxy.js",
  socket: "/var/lib/incus/unix.socket",
  project: "default",
}

describe("vsock proxy", () => {
  it("writes one ProxyCommand line its own parser reads back", () => {
    const line = proxyCommandOf(proxy, "/usr/bin/socat", "dsh-bot-a")
    expect(line).toBe(
      "/usr/bin/node /p/lib/vsock-proxy.js --socket /var/lib/incus/unix.socket --project default --instance dsh-bot-a --port 22 --socat /usr/bin/socat",
    )
    expect(parseProxyArgs(line.split(" ").slice(2))).toEqual({
      socket: "/var/lib/incus/unix.socket",
      project: "default",
      instance: "dsh-bot-a",
      port: 22,
      socat: "/usr/bin/socat",
    })
  })

  it("quotes only words that need it and refuses what ssh would expand", () => {
    expect(
      proxyCommandOf({ ...proxy, node: "/opt/my node/bin/node" }, "/usr/bin/socat", "x"),
    ).toMatch(/^'\/opt\/my node\/bin\/node' /)
    expect(() => proxyCommandOf({ ...proxy, script: "/100%/p.js" }, "/usr/bin/socat", "x")).toThrow(
      "unsupported character",
    )
  })

  it("refuses unknown, repeated, missing and malformed arguments", () => {
    const good = [
      "--socket",
      "/s",
      "--project",
      "p",
      "--instance",
      "i",
      "--port",
      "22",
      "--socat",
      "/usr/bin/socat",
    ]
    expect(() => parseProxyArgs([...good, "--extra", "x"])).toThrow("usage")
    expect(() => parseProxyArgs([...good, "--port", "23"])).toThrow("usage")
    expect(() => parseProxyArgs(good.slice(0, 8))).toThrow("--socat is required")
    expect(() => parseProxyArgs(good.map((v) => (v === "22" ? "70000" : v)))).toThrow("not a port")
    expect(() => parseProxyArgs(good.map((v) => (v === "/usr/bin/socat" ? "socat" : v)))).toThrow(
      "absolute",
    )
  })

  it("reads the vsock id, and refuses an instance without one", () => {
    const instance = (id?: string): IncusInstance => ({
      name: "vm",
      status: "Running",
      config: id === undefined ? {} : { "volatile.vsock_id": id },
      devices: {},
    })
    expect(vsockCidOf(instance("77"))).toBe(77)
    expect(() => vsockCidOf(instance())).toThrow("no vsock id")
    expect(() => vsockCidOf(instance("2"))).toThrow("no vsock id")
    expect(socatArgs(77, 22)).toEqual(["STDIO", "VSOCK-CONNECT:77:22"])
  })
})
