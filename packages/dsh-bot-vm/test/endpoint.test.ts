import { afterEach, describe, expect, it } from "vitest"
import { checkIncus } from "../src/host/backend/incus/check"
import { createIncusClient, type IncusClient } from "../src/host/backend/incus/client"
import { type IncusEndpoint, parseProjectName } from "../src/host/backend/incus/endpoint"
import { pair, untrustCommand } from "../src/host/backend/incus/pairing"
import { parseTrustToken, tokenUrls } from "../src/host/backend/incus/trust-token"
import { clientKeyRecord, recordSecretStore } from "../src/host/placement/secrets"
import { certificateFingerprint, createSelfSignedIdentity } from "../src/node/client-identity"
import { CertificatePinError, createIncusTransport } from "../src/node/incus-transport"
import { type FakeIncus, startFakeIncus } from "./support/fake-incus-server"
import { incusWith } from "./support/incus"

const servers: FakeIncus[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

async function fake() {
  const server = await startFakeIncus()
  servers.push(server)
  return server
}

const clientOf = (endpoint: IncusEndpoint) =>
  createIncusClient({
    transport: createIncusTransport(endpoint),
    project: "dsh-bots",
    operationTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  })

function identity() {
  return createSelfSignedIdentity({ commonName: "dsh-bots@test", now: new Date(), usage: "client" })
}

describe("self-signed client identity", () => {
  it("is a valid P-384 certificate for client authentication, signed by its own key", async () => {
    const { X509Certificate, createPrivateKey } = await import("node:crypto")
    const made = identity()
    const certificate = new X509Certificate(made.certificate)
    expect(certificate.subject).toBe("CN=dsh-bots@test")
    expect(certificate.verify(certificate.publicKey)).toBe(true)
    expect(certificate.checkPrivateKey(createPrivateKey(made.key))).toBe(true)
    expect(certificate.publicKey.asymmetricKeyDetails?.namedCurve).toBe("secp384r1")
    expect(certificate.keyUsage).toEqual(["1.3.6.1.5.5.7.3.2"])
    expect(certificate.ca).toBe(false)
    expect(certificateFingerprint(made.certificate)).toBe(made.fingerprint)
    expect(Date.parse(certificate.validTo) - Date.now()).toBeGreaterThan(9 * 365 * 24 * 3_600_000)
  })

  it("is valid from a day back, for a VM host whose clock is behind", async () => {
    const { X509Certificate } = await import("node:crypto")
    const now = new Date("2026-11-26T05:14:36.900Z")
    const made = createSelfSignedIdentity({ commonName: "dsh-bots@test", now, usage: "client" })
    const validFrom = Date.parse(new X509Certificate(made.certificate).validFrom)
    expect(now.getTime() - validFrom).toBeGreaterThanOrEqual(24 * 3_600_000)
    expect(now.getTime() - validFrom).toBeLessThan(24 * 3_600_000 + 1_000)
  })
})

describe("HTTPS transport with a pinned server certificate", () => {
  it("talks to the pinned server with its client certificate, uploads and relays a websocket", async () => {
    const server = await fake()
    const client = identity()
    server.trusted.add(client.fingerprint)
    const transport = createIncusTransport({
      url: server.url,
      serverCertificateSha256: server.fingerprint,
      clientCertificate: client.certificate,
      clientKey: client.key,
    })
    const response = await transport.json("GET", "/1.0")
    expect(response.body).toMatchObject({ metadata: { auth: "trusted" } })
    async function* body() {
      yield new Uint8Array(1000)
      yield new Uint8Array(24)
    }
    expect(
      (
        await transport.upload("/1.0/images", body(), {
          "Content-Type": "application/octet-stream",
        })
      ).status,
    ).toBe(200)
    expect(server.uploads).toEqual([1024])
    const channel = await transport.websocket("/1.0/operations/x/websocket?secret=s")
    const big = new Uint8Array(200_000).map((_, index) => index % 251)
    await channel.write(new TextEncoder().encode("ping"))
    await channel.write(big)
    await channel.end()
    const received: Uint8Array[] = []
    for await (const chunk of channel) received.push(chunk)
    const all = Buffer.concat(received)
    expect(all.subarray(0, 4).toString()).toBe("ping")
    expect(all.subarray(4).equals(Buffer.from(big))).toBe(true)
    transport.close()
  })

  it("refuses a server whose certificate is not the pinned one before sending anything", async () => {
    const server = await fake()
    const client = identity()
    const transport = createIncusTransport({
      url: server.url,
      serverCertificateSha256: "0".repeat(64),
      clientCertificate: client.certificate,
      clientKey: client.key,
    })
    await expect(
      transport.json("POST", "/1.0/certificates", { trust_token: "secret" }),
    ).rejects.toBeInstanceOf(CertificatePinError)
    await expect(transport.websocket("/1.0/operations/x/websocket")).rejects.toBeInstanceOf(
      CertificatePinError,
    )
    expect(server.requests).toEqual([])
  })
})

describe("pairing with a trust token", () => {
  it("parses a token and lists its URLs", async () => {
    const server = await fake()
    const token = parseTrustToken(
      `  ${server.token({ addresses: ["10.0.0.5:8443", "[fd00::5]:8443"] })}\n`,
    )
    expect(token.fingerprint).toBe(server.fingerprint)
    expect(token.expiresAt).toBeUndefined()
    expect(tokenUrls(token)).toEqual(["https://10.0.0.5:8443", "https://[fd00::5]:8443"])
    expect(() => parseTrustToken("not a token")).toThrow("not an Incus trust token")
  })

  it("registers a new client certificate and yields what to store", async () => {
    const server = await fake()
    const token = parseTrustToken(server.token())
    const paired = await pair(
      { token, url: tokenUrls(token)[0] as string, project: "dsh-bots", name: "dsh-bots@test" },
      {
        createIdentity: async (name) =>
          createSelfSignedIdentity({ commonName: name, now: new Date(), usage: "client" }),
        connect: (endpoint: IncusEndpoint) => ({ incus: clientOf(endpoint), close() {} }),
        now: Date.now,
      },
    )
    expect(paired).toMatchObject({
      url: server.url,
      serverCertificateSha256: server.fingerprint,
    })
    const fingerprint = certificateFingerprint(paired.clientCertificate)
    expect([...server.trusted]).toEqual([fingerprint])
    const incus = clientOf(paired)
    await expect(incus.server()).resolves.toMatchObject({ auth: "trusted" })
    expect(server.requests).toEqual(["GET /1.0", "POST /1.0/certificates", "GET /1.0", "GET /1.0"])
  })

  it("refuses an expired token without connecting, and a used one after connecting", async () => {
    const server = await fake()
    const deps = {
      createIdentity: async () => identity(),
      connect: (endpoint: IncusEndpoint) => ({ incus: clientOf(endpoint), close() {} }),
      now: Date.now,
    }
    const expired = parseTrustToken(server.token({ expiresAt: "2020-01-01T00:00:00Z" }))
    await expect(
      pair({ token: expired, url: server.url, project: "p", name: "n" }, deps),
    ).rejects.toThrow("expired")
    expect(server.requests).toEqual([])
    const token = parseTrustToken(server.token())
    await pair({ token, url: server.url, project: "p", name: "n" }, deps)
    await expect(pair({ token, url: server.url, project: "p", name: "n" }, deps)).rejects.toThrow(
      "(403): not authorized",
    )
  })

  it("refuses a server other than the token's", async () => {
    const server = await fake()
    const other = await fake()
    const token = parseTrustToken(server.token())
    await expect(
      pair(
        { token, url: other.url, project: "p", name: "n" },
        {
          createIdentity: async () => identity(),
          connect: (endpoint: IncusEndpoint) => ({ incus: clientOf(endpoint), close() {} }),
          now: Date.now,
        },
      ),
    ).rejects.toBeInstanceOf(CertificatePinError)
    expect(other.requests).toEqual([])
  })

  it("names the command that stops trusting this installation", () => {
    expect(untrustCommand("3197f45ef1fab066caecdf74")).toBe(
      "incus config trust remove 3197f45ef1fa",
    )
  })
})

describe("the client key", () => {
  it("is kept in a secret record of its own", async () => {
    const records = new Map<string, unknown>()
    const keys = recordSecretStore(
      {
        readRecord: async (key) => records.get(key) as never,
        modifyRecord: async (key, mutate) => void records.set(key, await mutate()),
        deleteRecord: async (key) => void records.delete(key),
      },
      clientKeyRecord("bot-vm"),
    )
    await expect(keys.read()).resolves.toBeUndefined()
    const made = identity()
    await keys.write(made.key)
    expect([...records.keys()]).toEqual(["bot-vm/incus-client"])
    await expect(keys.read()).resolves.toBe(made.key)
    records.set("bot-vm/incus-client", { kind: "other" })
    await expect(keys.read()).rejects.toThrow("not one @1outres/dsh-bot-vm wrote")
    await keys.clear()
    await expect(keys.read()).resolves.toBeUndefined()
  })

  it("takes Incus project names other than default", () => {
    expect(parseProjectName(" dsh-bots ")).toBe("dsh-bots")
    expect(() => parseProjectName("default")).toThrow('"default"')
    for (const bad of ["", "a/b", ".x", "x".repeat(64)]) {
      expect(() => parseProjectName(bad)).toThrow("not an Incus project name")
    }
  })
})

describe("checkIncus", () => {
  const healthy: Partial<IncusClient> = {
    server: async () => ({
      auth: "trusted",
      apiExtensions: [],
      serverVersion: "6.0.4",
      drivers: ["lxc", "qemu"],
    }),
    projectConfig: async () => ({
      restricted: "true",
      "user.dsh-bots.pool": "dsh",
      "user.dsh-bots.network": "dshbr0",
      "user.dsh-bots.egress-acl": "egress",
      "limits.disk.pool.other": "0",
    }),
    poolSpace: async () => 2 ** 37,
    hasNetwork: async (name) => name === "dshbr0",
    profiles: async () => [{ name: "default", devices: {} }],
  }

  it("reads the declaration when everything is there", async () => {
    await expect(
      checkIncus({ incus: incusWith(healthy), origin: "custom", project: "dsh-bots" }),
    ).resolves.toEqual({
      ok: true,
      declaration: { pool: "dsh", network: "dshbr0", egressAcl: "egress" },
    })
  })

  it("refuses the default project without asking Incus", async () => {
    const result = await checkIncus({ incus: incusWith({}), origin: "custom", project: "default" })
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toEqual([
      "project-default",
    ])
  })

  it("stops at an unreachable or untrusting server", async () => {
    const down = await checkIncus({
      incus: incusWith({ server: async () => Promise.reject(new Error("ECONNREFUSED")) }),
      origin: "custom",
      project: "p",
    })
    expect(down).toMatchObject({ ok: false, problems: [{ code: "unreachable" }] })
    const untrusted = await checkIncus({
      incus: incusWith({
        server: async () => ({
          auth: "untrusted",
          apiExtensions: [],
          serverVersion: "",
          drivers: [],
        }),
      }),
      origin: "custom",
      project: "p",
    })
    expect(untrusted).toMatchObject({ ok: false, problems: [{ code: "untrusted" }] })
  })

  it("lists everything missing at once", async () => {
    const result = await checkIncus({
      incus: incusWith({
        ...healthy,
        server: async () => ({
          auth: "trusted",
          apiExtensions: [],
          serverVersion: "6.0.3",
          drivers: ["lxc"],
        }),
        projectConfig: async () => ({
          "user.dsh-bots.pool": "dsh",
          "limits.disk.pool.dsh": "0",
          "user.dsh-bots.network": "elsewhere",
        }),
        profiles: async () => [
          {
            name: "dsh-bot",
            devices: {
              eth0: { type: "nic", network: "other" },
              root: { type: "disk", pool: "dsh", path: "/" },
            },
          },
        ],
      }),
      origin: "custom",
      project: "p",
    })
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toEqual([
      "incus-too-old",
      "no-vm-driver",
      "project-unrestricted",
      "pool-unusable",
      "network-unusable",
      "profile-foreign-device",
    ])
  })

  it("reports undeclared keys besides an unrestricted project", async () => {
    const result = await checkIncus({
      incus: incusWith({ ...healthy, projectConfig: async () => ({}) }),
      origin: "custom",
      project: "p",
    })
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toEqual([
      "project-unrestricted",
      "pool-undeclared",
      "network-undeclared",
    ])
  })

  it("gives commands to an administrator, and repair for a VM host dsh-bots built", async () => {
    const config = { ...healthy, projectConfig: async () => ({ restricted: "true" }) }
    const custom = await checkIncus({ incus: incusWith(config), origin: "custom", project: "p" })
    expect(custom.ok ? [] : custom.problems[0]).toEqual({
      scope: "incus",
      code: "pool-undeclared",
      message: 'the project "p" names no storage pool (user.dsh-bots.pool)',
      fix: { kind: "command", text: "incus project set p user.dsh-bots.pool=<pool>" },
    })
    const managed = await checkIncus({ incus: incusWith(config), origin: "managed", project: "p" })
    expect(managed.ok ? [] : managed.problems.map((problem) => problem.fix)).toEqual([
      { kind: "repair" },
      { kind: "repair" },
    ])
  })

  it("reports a missing project", async () => {
    const result = await checkIncus({
      incus: incusWith({
        ...healthy,
        projectConfig: async () => Promise.reject(new Error("(404): not found")),
      }),
      origin: "custom",
      project: "p",
    })
    expect(result).toMatchObject({ ok: false, problems: [{ code: "project-missing" }] })
  })
})
