import { describe, expect, it } from "vitest"
import { spaceIdOf } from "../src/shared/spaces"
import { call, spacesHarness } from "./support/spaces"

const ID = spaceIdOf("b1", "demo")

async function ready(baseUrl: string | null = "https://dsh.example/") {
  const h = await spacesHarness(baseUrl === null ? {} : { baseUrl })
  await call(h, "space_create", { space: "demo", title: "Demo", pinned: true })
  return h
}

describe("the space tools", () => {
  it("create a Space with a starting page, publish it and list it", async () => {
    const h = await ready()
    expect(new TextDecoder().decode(h.fs.files.get("/home/bot/spaces/demo/index.html"))).toContain(
      "<h1>Demo</h1>",
    )
    expect((await call(h, "space_publish", { space: "demo" })).text).toContain(
      "Published revision 1",
    )
    const listed = JSON.parse((await call(h, "space_list", {})).text)
    expect(listed).toEqual([
      expect.objectContaining({
        space: "demo",
        revision: 1,
        visibility: "owner",
        visitorWrites: false,
        pinned: true,
      }),
    ])
    await expect(call(h, "space_create", { space: "demo", title: "Again" })).rejects.toThrow(
      "already have",
    )
    await expect(call(h, "space_create", { space: "Bad Slug", title: "x" })).rejects.toThrow(
      "space must be",
    )
  })

  it("lists violations instead of publishing, and keeps 5 revisions", async () => {
    const h = await ready()
    h.fs.write("spaces/demo/tool.exe", "x")
    expect((await call(h, "space_publish", { space: "demo" })).text).toContain(
      "- tool.exe has an extension",
    )
    h.fs.files.delete("/home/bot/spaces/demo/tool.exe")
    for (let index = 0; index < 7; index += 1) {
      h.fs.write("spaces/demo/index.html", `v${index}`)
      await call(h, "space_publish", { space: "demo" })
    }
    expect(h.spaces.store.revisions(ID).map((revision) => revision.number)).toEqual([7, 6, 5, 4, 3])
    expect(h.io.blobs.size).toBe(5)
  })

  it("hide other bots' Spaces behind no such space", async () => {
    const h = await ready()
    await expect(call(h, "space_publish", { space: "demo" }, "b2")).rejects.toThrow("no such space")
    await expect(call(h, "space_publish", { space: "nope" })).rejects.toThrow("no such space")
  })

  it("are offered in Main and Web sessions only", async () => {
    const h = await ready()
    expect(h.spaces.tools.available("b1", "sealed", "s1")).toBe(true)
    h.kind = "schedule"
    expect(h.spaces.tools.available("b1", "sealed", "s1")).toBe(false)
    await expect(call(h, "space_list", {})).rejects.toThrow("Spaces work only")
    expect(h.spaces.tools.available("b1", "forged", "s1")).toBe(false)
  })

  it("delete only in a turn the owner started", async () => {
    const h = await ready()
    h.turn = { startedBy: "other", mixed: false }
    await expect(call(h, "space_delete", { space: "demo" })).rejects.toThrow(
      "only when your owner asks",
    )
    h.turn = { startedBy: "owner", mixed: false }
    expect((await call(h, "space_delete", { space: "demo" })).text).toContain("Deleted")
    expect(h.spaces.store.list("b1")).toEqual([])
  })

  it("make links without approval for the owner at a private home, with approval otherwise", async () => {
    const h = await ready()
    expect((await call(h, "space_link", { space: "demo", reason: "to check" })).text).toMatch(
      /^Link \(works until .*\): https:\/\/dsh\.example\/bot-spaces\/v\/[A-Za-z0-9_-]{43}\/$/,
    )
    expect(h.approvals.link.asked).toHaveLength(0)
    h.shared = true
    await call(h, "space_link", { space: "demo", reason: "share" })
    expect(h.approvals.link.asked).toHaveLength(1)
    expect(h.approvals.link.asked[0]?.detail.en).toContain("shared with other people")
    h.shared = false
    h.turn = { startedBy: "other", mixed: false }
    h.approvals.link.answer = "rejected"
    await expect(call(h, "space_link", { space: "demo", reason: "visitor" })).rejects.toThrow(
      "declined",
    )
    expect(h.spaces.access.links(ID)).toHaveLength(2)
  })

  it("refuse links without a public base URL", async () => {
    const h = await ready(null)
    await expect(call(h, "space_link", { space: "demo", reason: "x" })).rejects.toThrow(
      "outside links are off",
    )
    const made = await call(h, "space_visibility", {
      space: "demo",
      visibility: "public",
      reason: "show",
    })
    expect(made.text).toContain("is public. outside links are off")
  })

  it("make a Space public only when the owner approves, and owner only again freely", async () => {
    const h = await ready()
    h.approvals.visibility.answer = "withdrawn"
    await expect(
      call(h, "space_visibility", { space: "demo", visibility: "public", reason: "show" }),
    ).rejects.toThrow("withdrawn")
    h.approvals.visibility.answer = "approved"
    expect(
      (await call(h, "space_visibility", { space: "demo", visibility: "public", reason: "show" }))
        .text,
    ).toContain("https://dsh.example/bot-spaces/v/")
    expect(h.approvals.visibility.asked[1]?.question.en).toContain('Make the Space "Demo" public?')
    expect(
      (await call(h, "space_visibility", { space: "demo", visibility: "owner", reason: "done" }))
        .text,
    ).toContain("owner only")
    expect(h.approvals.visibility.asked).toHaveLength(2)
  })

  it("let visitors write only with approval and stop them freely", async () => {
    const h = await ready()
    h.approvals.visitorWrites.answer = "rejected"
    await expect(
      call(h, "space_visitor_writes", { space: "demo", allowed: true, reason: "poll" }),
    ).rejects.toThrow("declined")
    expect(h.spaces.store.get(ID)?.visitorWrites).toBe(false)
    h.approvals.visitorWrites.answer = "approved"
    await call(h, "space_visitor_writes", { space: "demo", allowed: true, reason: "poll" })
    expect(h.spaces.store.get(ID)?.visitorWrites).toBe(true)
    await call(h, "space_visitor_writes", { space: "demo", allowed: false, reason: "stop" })
    expect(h.spaces.store.get(ID)?.visitorWrites).toBe(false)
    expect(h.approvals.visitorWrites.asked).toHaveLength(2)
  })

  it("read and write the store, refusing bad entries whole", async () => {
    const h = await ready()
    await call(h, "space_kv_set", {
      space: "demo",
      entries: [
        { key: "a", value: 1 },
        { key: "b/c", value: { x: true } },
      ],
    })
    expect(JSON.parse((await call(h, "space_kv_get", { space: "demo", key: "a" })).text)).toEqual({
      key: "a",
      value: 1,
    })
    expect(
      JSON.parse((await call(h, "space_kv_get", { space: "demo", prefix: "b/" })).text).entries,
    ).toEqual([{ key: "b/c", value: { x: true } }])
    await expect(
      call(h, "space_kv_set", {
        space: "demo",
        entries: [
          { key: "ok", value: 1 },
          { key: "bad key", value: 2 },
        ],
      }),
    ).rejects.toThrow("not a valid key")
    expect((await call(h, "space_kv_get", { space: "demo", key: "ok" })).text).toBe(
      '"ok" is not set.',
    )
    await call(h, "space_kv_set", { space: "demo", delete: ["a"] })
    expect((await call(h, "space_kv_get", { space: "demo", key: "a" })).text).toBe(
      '"a" is not set.',
    )
    expect((await call(h, "space_post", { space: "demo", name: "hi" })).text).toContain("No page")
  })

  it("forget the Spaces of deleted bots with their blobs", async () => {
    const h = await ready()
    await call(h, "space_publish", { space: "demo" })
    h.bots.delete("b1")
    await h.spaces.manager.forget((botId) => h.bots.has(botId))
    expect(h.spaces.store.list()).toEqual([])
    expect(h.io.blobs.size).toBe(0)
  })
})
