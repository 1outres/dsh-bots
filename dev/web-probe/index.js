// Verification only (spike for docs/specs/bot-web.md): never built, published or bundled.
// One package, two roles. role "host" sits in the Host composition; role "group" sits inside an
// isolated cordis:group of an Agent preset, next to a second @deepseek-ai/dsh-web.
// The host role serves a fake Exa API on 127.0.0.1:<mockPort> and runs triggers:
// JSON files dropped in <dir>/trigger/*.json, results appended to <dir>/results.log.
//   {"op":"state"}                                   identities, provider lists, settings namespaces
//   {"op":"setcred","ref":"NAME","value":"..."}      ctx.credentials.set
//   {"op":"search","target":"host|group","query":"..."}
//   {"op":"fetch","target":"host|group","url":"..."}
//   {"op":"tool","name":"web_search|web_fetch","args":{...}}   the group's tool-web definition, executed directly

import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs"
import http from "node:http"
import { join } from "node:path"

const DSH = "/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/"

export const name = "web-probe"
export const inject = ["web"]

globalThis.__dshWebProbe ??= { host: undefined, groups: [], events: [] }
const state = globalThis.__dshWebProbe

const describeError = (error) => ({
  name: error?.name,
  code: error?.code,
  message: String(error?.message ?? error),
})

function logger(dir) {
  return (entry) =>
    appendFileSync(
      join(dir, "results.log"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    )
}

function mockExa(port, log) {
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      const key = req.headers["x-api-key"]
      log({ op: "mock-exa", path: req.url, apiKey: key, body: JSON.parse(body || "{}") })
      res.setHeader("content-type", "application/json")
      if (req.url === "/search") {
        res.end(
          JSON.stringify({
            results: [
              {
                url: "https://example.com/mock-exa",
                title: `mock exa (key ${key})`,
                highlights: ["mock highlight"],
              },
            ],
          }),
        )
      } else {
        const url = JSON.parse(body || "{}").urls?.[0]
        res.end(
          JSON.stringify({
            results: [{ url, text: `mock contents (key ${key})` }],
            statuses: [{ id: url, status: "success" }],
          }),
        )
      }
    })
  })
  server.listen(port, "127.0.0.1")
  return server
}

async function run(ctx, request, log) {
  const host = state.host
  const group = state.groups.at(-1)
  const target = request.target === "group" ? group : host
  switch (request.op) {
    case "state": {
      const settings = ctx.get("settings")
      const configEditor = ctx.get("configEditor")
      log({
        op: "state",
        hostWebIsRootWeb: host.ctx.root.get("web") === host.web,
        groups: state.groups.map((g) => ({
          label: g.label,
          groupWebIsHostWeb: g.web === host.web,
          groupRootWebIsHostWeb: g.ctx.root.get("web") === host.web,
          providers: g.web.listProviders(),
        })),
        hostProviders: host.web.listProviders(),
        events: state.events,
        settingsNamespaces: settings?.describe({ redactSecrets: true }).map((d) => d.ns),
        configEntries: configEditor?.configuration().map((c) => c.entry.id),
      })
      return
    }
    case "setcred": {
      const { credentialRef } = await import(`${DSH}dsh-credentials/lib/index.js`)
      await ctx.get("credentials").set(credentialRef(request.ref), request.value)
      log({ op: "setcred", ref: request.ref })
      return
    }
    case "search":
    case "fetch": {
      const ready =
        request.op === "search" ? await target.web.searchReady() : await target.web.fetchReady()
      try {
        const result =
          request.op === "search"
            ? await target.web.search({ query: request.query, maxResults: 3 })
            : await target.web.fetch({ url: request.url })
        log({ op: request.op, target: request.target, ready, result })
      } catch (error) {
        log({ op: request.op, target: request.target, ready, error: describeError(error) })
      }
      return
    }
    case "tool": {
      const { scopeOf } = await import(`${DSH}dsh-scope/lib/index.js`)
      const scope = scopeOf(group.ctx)
      const registry = group.ctx.get("tools")
      const definition = registry.get(request.name, scope)
      const globalDefinition = registry.get(request.name)
      if (definition === undefined) {
        log({
          op: "tool",
          name: request.name,
          scoped: scope !== undefined,
          found: false,
          global: globalDefinition !== undefined,
        })
        return
      }
      try {
        const value = await definition.execute(request.args, { signal: AbortSignal.timeout(20000) })
        log({
          op: "tool",
          name: request.name,
          scoped: scope !== undefined,
          global: globalDefinition !== undefined,
          value,
        })
      } catch (error) {
        log({ op: "tool", name: request.name, error: describeError(error) })
      }
      return
    }
    default:
      log({ op: request.op, error: "unknown op" })
  }
}

function watchTriggers(ctx, dir, log) {
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
          await run(ctx, request, log)
        } catch (error) {
          log({ op: request.op, error: describeError(error) })
        }
      }
    } finally {
      busy = false
    }
  }, 500)
  return () => clearInterval(timer)
}

export function apply(ctx, config) {
  const { dir, role, label } = config
  const log = logger(dir)
  mkdirSync(join(dir, "trigger"), { recursive: true })
  mkdirSync(join(dir, "done"), { recursive: true })
  const web = ctx.web
  ctx.on("web/providers-changed", () => {
    state.events.push({ observer: label, providers: web.listProviders() })
  })
  if (role === "group") {
    const entry = { label, ctx, web }
    state.groups.push(entry)
    ctx.web.registerSearchProvider({
      id: "probe-bot",
      title: "Probe (bot group)",
      available: () => true,
      search: async (request) => {
        log({ op: "probe-bot-search", request })
        return {
          sources: [{ url: "https://example.com/probe-bot", title: `probe-bot: ${request.query}` }],
          truncated: false,
        }
      },
    })
    ctx.effect(() => () => {
      state.groups.splice(state.groups.indexOf(entry), 1)
    })
  } else {
    state.host = { label, ctx, web }
    const server = mockExa(config.mockPort, log)
    ctx.effect(() => () => {
      server.close()
    })
    ctx.effect(() => watchTriggers(ctx, dir, log))
  }
  log({
    op: "loaded",
    role,
    label,
    ownWebIsRootWeb: ctx.root.get("web") === web,
    providers: web.listProviders(),
  })
}
