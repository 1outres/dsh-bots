import { describe, expect, it } from "vitest"
import { linkIdOf, spaceIdOf } from "../src/shared/spaces"
import { call, spacesHarness } from "./support/spaces"

const DAY = 24 * 60 * 60_000
const ID = spaceIdOf("b1", "demo")

async function withSpace() {
  const h = await spacesHarness({ baseUrl: "https://dsh.example/" })
  await call(h, "space_create", { space: "demo", title: "Demo" })
  return h
}

describe("Space access", () => {
  it("resolves frame tokens as the owner until they expire, kept in memory only", async () => {
    const h = await withSpace()
    const frame = h.spaces.access.frame(ID)
    expect(h.spaces.access.resolve(frame.token)).toMatchObject({
      kind: "frame",
      viewer: "owner",
      spaceId: ID,
    })
    expect([...h.spaces.store.accesses(ID)]).toEqual([])
    h.clock.now += 12 * 60 * 60_000
    expect(h.spaces.access.resolve(frame.token)).toBeUndefined()
  })

  it("stores links as hashes with an expiry, and revokes them", async () => {
    const h = await withSpace()
    const grant = await h.spaces.manager.link(ID, {
      label: "phone",
      days: 2,
      reason: null,
      issuedBy: "owner",
    })
    const stored = h.spaces.store.access(grant.hash)
    expect(stored).toMatchObject({ kind: "link", token: null, expiresAt: h.clock.now + 2 * DAY })
    expect(JSON.stringify([...h.spaces.store.accesses(ID)])).not.toContain(grant.token)
    expect(h.spaces.access.resolve(grant.token)?.viewer).toBe("link")
    expect(await h.spaces.manager.revokeLink(ID, linkIdOf(grant.hash))).toBe(true)
    expect(h.spaces.access.resolve(grant.token)).toBeUndefined()
    const other = await h.spaces.manager.link(ID, {
      label: "x",
      days: 1,
      reason: null,
      issuedBy: "owner",
    })
    h.clock.now += DAY
    expect(h.spaces.access.resolve(other.token)).toBeUndefined()
  })

  it("issues one public token while public, refuses it once owner only, and a new one after", async () => {
    const h = await withSpace()
    const first = await h.spaces.manager.setVisibility(ID, "public", "owner")
    const again = await h.spaces.manager.setVisibility(ID, "public", "owner")
    expect(again.token).toBe(first.token)
    expect(h.spaces.access.resolve(first.token as string)?.viewer).toBe("public")
    await h.spaces.manager.setVisibility(ID, "owner", "owner")
    expect(h.spaces.access.resolve(first.token as string)).toBeUndefined()
    const next = await h.spaces.manager.setVisibility(ID, "public", "owner")
    expect(next.token).not.toBe(first.token)
    expect(h.spaces.access.resolve(first.token as string)).toBeUndefined()
  })

  it("refuses malformed tokens and tokens of deleted Spaces alike", async () => {
    const h = await withSpace()
    const grant = await h.spaces.manager.link(ID, {
      label: "x",
      days: 1,
      reason: null,
      issuedBy: "owner",
    })
    expect(h.spaces.access.resolve("short")).toBeUndefined()
    await h.spaces.manager.discard(ID)
    expect(h.spaces.access.resolve(grant.token)).toBeUndefined()
  })
})
