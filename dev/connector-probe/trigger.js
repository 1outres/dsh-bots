import { mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"

async function handle(bot, record, request) {
  switch (request.op) {
    case "enable":
      record({
        op: "enable",
        view: await bot.configureConnector(request.botId, request.connectorId, {
          enabled: request.enabled,
          values: request.values ?? {},
        }),
      })
      return
    case "states":
      record({ op: "states", states: bot.connectorStates(request.botId) })
      return
    case "retry":
      record({ op: "retry", view: bot.retryConnector(request.botId, request.connectorId) })
      return
    case "permission":
      record({
        op: "permission",
        result: await bot.setConnectorPermission(request.botId, {
          connectorId: request.connectorId ?? "probe",
          tool: request.tool,
          permission: request.permission,
        }),
      })
      return
    case "list":
      record({ op: "list", actions: bot.connectorActions(request.botId) })
      return
    default:
      record({ op: request.op, error: "unknown op" })
  }
}

export function watchTriggers(ctx, bot, dir, record) {
  mkdirSync(join(dir, "trigger"), { recursive: true })
  mkdirSync(join(dir, "done"), { recursive: true })
  ctx.effect(
    () =>
      bot.onConnectorActionChange(({ action }) =>
        record({ op: "change", id: action.id, state: action.status.state }),
      ),
    "connector-probe: action changes",
  )
  ctx.effect(
    () =>
      bot.onConnectorStateChange((botId) =>
        record({
          op: "readiness",
          botId,
          states: bot.connectorStates(botId).map((view) => ({
            id: view.connector.id,
            enabled: view.enabled,
            readiness: view.readiness,
          })),
        }),
      ),
    "connector-probe: state changes",
  )
  let busy = false
  const timer = setInterval(async () => {
    if (busy) return
    busy = true
    try {
      for (const file of readdirSync(join(dir, "trigger"))
        .filter((f) => f.endsWith(".json"))
        .sort()) {
        const path = join(dir, "trigger", file)
        const request = JSON.parse(readFileSync(path, "utf8"))
        renameSync(path, join(dir, "done", file))
        try {
          await handle(bot, record, request)
        } catch (error) {
          record({ op: request.op, file, thrown: String(error?.stack ?? error) })
        }
      }
    } finally {
      busy = false
    }
  }, 500)
  ctx.effect(() => () => clearInterval(timer), "connector-probe: trigger poll")
}
