import { describe, expect, it } from "vitest"
import { z } from "zod"
import { DISCORD_DOMAIN } from "../src/host/actions/domain"

/**
 * Records already stored must keep parsing: a changed snapshot needs either a
 * compatible change (a new optional field) or a version bump of the domain.
 */
describe("DISCORD_DOMAIN", () => {
  it("keeps its stored shape unless its version goes up", async () => {
    const tables = Object.fromEntries(
      Object.entries(DISCORD_DOMAIN.tables).map(([name, table]) => [
        name,
        z.toJSONSchema(table.valueSchema),
      ]),
    )
    await expect(
      JSON.stringify(
        { name: DISCORD_DOMAIN.name, version: DISCORD_DOMAIN.version, tables },
        null,
        2,
      ),
    ).toMatchFileSnapshot("__snapshots__/discord-domain.schema.snap")
  })
})
