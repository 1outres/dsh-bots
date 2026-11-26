import { DiscordAPIError, REST, RESTJSONErrorCodes } from "discord.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DiscordLookupError } from "../src/host/discord"
import { openDiscordJsLookup } from "../src/host/discordjs/lookup"

const signal = new AbortController().signal
const APP = "700000000000000001"
const BOT = "800000000000000001"
const OWNER = "111111111111111111"
const GUILD = "333333333333333333"

const apiError = (status: number, code: number) =>
  new DiscordAPIError({ code, message: "refused" }, code, status, "GET", "/x", {})

function stubbed(answer: (route: string, query?: URLSearchParams) => unknown) {
  const rest = new REST({ version: "10" })
  const routes: string[] = []
  vi.spyOn(rest, "get").mockImplementation(async (route, options) => {
    const query = options?.query as URLSearchParams | undefined
    routes.push(query === undefined ? route : `${route}?${query}`)
    const value = answer(route, query)
    if (value instanceof Error) throw value
    return value
  })
  return { lookup: openDiscordJsLookup("tok", rest), routes }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("discord.js lookup", () => {
  it("reads the application, its owner, the bot and the privileged intents the Portal turned on", async () => {
    const { lookup } = stubbed((route) =>
      route === "/applications/@me"
        ? {
            id: APP,
            flags: 1 << 15,
            owner: { id: OWNER, username: "alice", global_name: "Alice", avatar: "abc" },
            team: null,
          }
        : { id: BOT, username: "helper", global_name: null, avatar: null, bot: true },
    )
    const app = await lookup.application(signal)
    expect(app).toMatchObject({
      id: APP,
      bot: { id: BOT, displayName: "helper", bot: true },
      owners: [{ id: OWNER, displayName: "Alice", username: "alice" }],
      intents: { members: true, messageContent: false },
    })
    expect(app.owners[0]?.avatarUrl).toContain(`/avatars/${OWNER}/abc.png`)
    expect(app.bot.avatarUrl).toContain("/embed/avatars/")
  })

  it("tells a rejected token, a missing member and the Server Members intent apart", async () => {
    const { lookup } = stubbed((route) =>
      route === "/applications/@me"
        ? apiError(401, 0)
        : route.endsWith("/members")
          ? apiError(403, RESTJSONErrorCodes.MissingAccess)
          : apiError(404, RESTJSONErrorCodes.UnknownMember),
    )
    await expect(lookup.application(signal)).rejects.toMatchObject({ failure: "token-rejected" })
    await expect(lookup.member(GUILD, OWNER, signal)).resolves.toBeUndefined()
    const listing = lookup.members(GUILD, signal)
    await expect(listing).rejects.toBeInstanceOf(DiscordLookupError)
    await expect(listing).rejects.toMatchObject({ failure: "members-intent" })
  })

  it("pages through a server's members by id, with their server nicknames", async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        user: {
          id: String(100000000000000000 + from + index),
          username: `u${from + index}`,
          global_name: null,
          avatar: null,
        },
        nick: from + index === 0 ? "Boss" : null,
        roles: [],
      }))
    const { lookup, routes } = stubbed((_route, query) =>
      query?.get("after") === "0" ? page(0, 1000) : page(1000, 3),
    )
    const members = await lookup.members(GUILD, signal)
    expect(members).toHaveLength(1003)
    expect(members[0]?.user.displayName).toBe("Boss")
    expect(routes).toHaveLength(2)
    expect(routes[1]).toContain(`after=${members[999]?.user.id}`)
  })
})
