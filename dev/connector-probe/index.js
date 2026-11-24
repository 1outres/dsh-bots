// Verification only (dev/, outside packages/: never built, published or bundled). See README.md.
import { probeConnectors } from "./connectors.js"
import { discard, fileJournal } from "./journal.js"
import { watchTriggers } from "./trigger.js"

export const name = "connector-probe"
export const inject = ["bot"]

const readEnvironment = (env) => ({
  dir: env.CONNECTOR_PROBE_DIR,
  minMemoryMiB:
    env.CONNECTOR_PROBE_MIN_MEMORY_MIB === undefined
      ? undefined
      : Number(env.CONNECTOR_PROBE_MIN_MEMORY_MIB),
  manyTools: env.CONNECTOR_PROBE_MANY_TOOLS === "1",
})

export function apply(ctx) {
  const bot = ctx.get("bot")
  const { dir, minMemoryMiB, manyTools } = readEnvironment(process.env)
  const record = dir === undefined ? discard : fileJournal(dir)
  for (const connector of probeConnectors({ record, minMemoryMiB, manyTools }))
    ctx.effect(() => bot.registerConnector(connector), `connector-probe: ${connector.id}`)
  if (dir === undefined) return
  watchTriggers(ctx, bot, dir, record)
  record({ op: "loaded" })
}
