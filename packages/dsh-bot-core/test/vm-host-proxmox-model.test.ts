import { describe, expect, it } from "vitest"
import {
  createPoolCommand,
  emptyProxmox,
  nameserversOf,
  proxmoxPreviewed,
  proxmoxRequest,
} from "../src/client/vm-host/proxmox-model"

const preview = {
  backend: "proxmox" as const,
  url: "https://pve:8006",
  serverFingerprint: "ab".repeat(32),
  sourceAddress: "10.0.0.2",
}

const filled = () => ({
  ...proxmoxPreviewed({ ...emptyProxmox(), url: preview.url }, preview),
  tokenId: " dsh-bots@pve!plugin ",
  tokenSecret: "secret",
  node: "pve1",
})

describe("the Proxmox form", () => {
  it("takes this installation's address from the preview unless one is typed", () => {
    expect(filled().sshSource).toBe("10.0.0.2")
    const typed = proxmoxPreviewed({ ...emptyProxmox(), sshSource: "192.0.2.9" }, preview)
    expect(typed.sshSource).toBe("192.0.2.9")
  })

  it("builds the request only when every field is valid and the preview is for the URL", () => {
    expect(proxmoxRequest(filled())).toEqual({
      backend: "proxmox",
      url: "https://pve:8006",
      tokenId: "dsh-bots@pve!plugin",
      tokenSecret: "secret",
      serverFingerprint: "ab".repeat(32),
      node: "pve1",
      pool: "dsh-bots",
      storage: "dshbots",
      bridge: "vmbr0",
      sshSource: "10.0.0.2",
      nameservers: ["1.1.1.1", "9.9.9.9"],
    })
    expect(proxmoxRequest({ ...filled(), url: "https://other:8006" })).toBeNull()
    expect(proxmoxRequest({ ...filled(), tokenId: "dsh-bots" })).toBeNull()
    expect(proxmoxRequest({ ...filled(), tokenSecret: " " })).toBeNull()
    expect(proxmoxRequest({ ...filled(), sshSource: "host" })).toBeNull()
    expect(proxmoxRequest({ ...emptyProxmox(), url: preview.url })).toBeNull()
  })

  it("reads one to three distinct IPv4 DNS servers", () => {
    expect(nameserversOf("1.1.1.1, 9.9.9.9")).toEqual(["1.1.1.1", "9.9.9.9"])
    expect(nameserversOf("")).toBeNull()
    expect(nameserversOf("1.1.1.1 1.1.1.1")).toBeNull()
    expect(nameserversOf("1.1.1.1 2.2.2.2 3.3.3.3 4.4.4.4")).toBeNull()
    expect(nameserversOf("dns.example")).toBeNull()
  })

  it("gives the administrator the script of this version", () => {
    expect(createPoolCommand("1.2.3")).toContain("v1.2.3")
    expect(createPoolCommand("1.2.3")).toContain("infra/proxmox/create-pool.sh --help")
  })
})
