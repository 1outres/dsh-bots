import { describe, expect, it } from "vitest"
import {
  emptyPairing,
  endpointUrlAllowed,
  fingerprintText,
  pairingRequest,
  previewed,
  progressOf,
  projectAllowed,
  vmHostBadge,
} from "../src/client/vm-host/model"
import type { EnvironmentHostSettingsView } from "../src/shared/environment-host"

const PREVIEW = { clientName: "c", serverFingerprint: "ab".repeat(32), urls: ["https://h:8443"] }

const host = (change: Partial<EnvironmentHostSettingsView>): EnvironmentHostSettingsView => ({
  placement: { kind: "local", socket: "/s", project: "dsh-bots", chosen: false },
  check: { state: "ready", at: 0, declaration: { pool: "p", network: "n", egressAcl: "acl" } },
  egress: [],
  released: [],
  ...change,
})

const badgeOf = (view: EnvironmentHostSettingsView) =>
  vmHostBadge({ status: "ready", value: { status: "ready", host: view } })?.tone ?? null

describe("VM host model", () => {
  it("takes project names other than default and https URLs with only host and port", () => {
    expect(projectAllowed("dsh-bots")).toBe(true)
    expect(projectAllowed("default")).toBe(false)
    expect(projectAllowed("a/b")).toBe(false)
    expect(endpointUrlAllowed("https://h:8443")).toBe(true)
    expect(endpointUrlAllowed("http://h:8443")).toBe(false)
    expect(endpointUrlAllowed("https://h:8443/x")).toBe(false)
    expect(fingerprintText("abcdef")).toBe("ab:cd:ef")
  })

  it("pairs only once a token was read, with a valid address and project, and not expired", () => {
    const empty = emptyPairing("dsh-bots")
    expect(pairingRequest(empty, "t", 0)).toBeNull()
    const read = previewed(empty, PREVIEW)
    expect(pairingRequest(read, " t ", 0)).toEqual({
      token: "t",
      url: "https://h:8443",
      project: "dsh-bots",
    })
    expect(pairingRequest({ ...read, address: { kind: "other", url: "" } }, "t", 0)).toBeNull()
    expect(pairingRequest({ ...read, project: "default" }, "t", 0)).toBeNull()
    expect(pairingRequest(previewed(empty, { ...PREVIEW, expiresAt: 5 }), "t", 5)).toBeNull()
    expect(previewed(empty, { ...PREVIEW, urls: [] }).address).toEqual({ kind: "other", url: "" })
  })

  it("marks the nav: danger for a failed check, warning for open egress or a missing image", () => {
    expect(badgeOf(host({}))).toBeNull()
    expect(badgeOf(host({ check: { state: "failed", at: 0, problems: [] } }))).toBe("danger")
    expect(
      badgeOf(host({ check: { state: "ready", at: 0, declaration: { pool: "p", network: "n" } } })),
    ).toBe("warning")
    expect(
      badgeOf(
        host({
          egress: [
            { botId: "a", botName: "A", measure: { state: "open", at: 0, reached: ["x:1"] } },
          ],
        }),
      ),
    ).toBe("warning")
    expect(
      badgeOf(host({ image: { alias: "a", managed: true, status: { kind: "missing" } } })),
    ).toBe("warning")
  })

  it("shows progress in GiB to a tenth", () => {
    expect(progressOf(512 * 1024 ** 2, 2 * 1024 ** 3)).toEqual({ done: 0.5, total: 2, percent: 25 })
    expect(progressOf(0, 0).percent).toBe(0)
  })
})
