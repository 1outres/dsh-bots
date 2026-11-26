import { describe, expect, it } from "vitest"
import { spaceIdOf } from "../src/shared/spaces"
import { call, spacesHarness } from "./support/spaces"

const ID = spaceIdOf("b1", "demo")
const OWNER = { kind: "owner" }

async function ready() {
  const h = await spacesHarness()
  await call(h, "space_create", { space: "demo", title: "Demo" })
  return h
}

describe("the botSpaces Remote", () => {
  it("answers the DSH owner only", async () => {
    const h = await ready()
    expect(() => h.spaces.panel.view({ kind: "guest" })).toThrow("only the owner")
    await expect(h.spaces.panel.frame(undefined, ID)).rejects.toMatchObject({
      code: "bot-space/not-owner",
    })
  })

  it("lists Spaces with links, the public URL and the settings", async () => {
    const h = await ready()
    expect(h.spaces.panel.view(OWNER).settings).toEqual({
      publicBaseUrl: null,
      suggestedBaseUrl: "http://10.0.0.1:3080/",
    })
    const link = await h.spaces.panel.createLink(OWNER, ID, { label: "phone", days: 1 })
    expect(link).toMatchObject({
      url: null,
      relativeUrl: expect.stringMatching(/^\/bot-spaces\/v\/.{43}\/$/),
    })
    await expect(
      h.spaces.panel.setPublicBaseUrl(OWNER, "https://u:p@x.example"),
    ).rejects.toMatchObject({ code: "bot-space/invalid-base-url" })
    expect(await h.spaces.panel.setPublicBaseUrl(OWNER, " https://x.example/dsh ")).toMatchObject({
      publicBaseUrl: "https://x.example/dsh/",
    })
    await h.spaces.panel.setVisibility(OWNER, ID, "public")
    const view = await h.spaces.panel.setVisitorWrites(OWNER, ID, true)
    expect(view).toMatchObject({
      visibility: "public",
      visitorWrites: true,
      links: [{ id: link.id, label: "phone", issuedBy: "owner" }],
    })
    expect(view.publicUrl).toMatch(/^https:\/\/x\.example\/dsh\/bot-spaces\/v\/.{43}\/$/)
    const frame = await h.spaces.panel.frame(OWNER, ID)
    expect(frame.url).toMatch(/^\/bot-spaces\/s\/.{43}\/$/)
    expect((await h.spaces.panel.revokeLink(OWNER, ID, link.id)).links).toEqual([])
    await expect(h.spaces.panel.revokeLink(OWNER, ID, link.id)).rejects.toMatchObject({
      code: "bot-space/not-found",
    })
    expect(await h.spaces.panel.discard(OWNER, ID)).toEqual({ discarded: true })
    expect(h.spaces.panel.view(OWNER).spaces).toEqual([])
    await expect(h.spaces.panel.setPinned(OWNER, ID, true)).rejects.toMatchObject({
      code: "bot-space/not-found",
    })
  })
})
