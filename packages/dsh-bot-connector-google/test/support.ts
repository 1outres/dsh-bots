import type { BotConnectorEnvironment } from "@1outres/dsh-bot-core"
import { expect } from "vitest"
import { createFakeGoogle } from "../../../dev/fake-google/server.js"
import { connectionsSetup, OWNER } from "../../dsh-bot-core/test/connections-support"
import { settle } from "../../dsh-bot-core/test/connectors-support"
import { createOwnChanges } from "../src/host/calendar/own"
import { calendarConnector, gmailConnector } from "../src/host/connectors"
import { developmentEndpoints } from "../src/host/endpoints"
import { createGoogle } from "../src/host/google"
import { googleProvider } from "../src/host/provider"

export const world: { fake: ReturnType<typeof createFakeGoogle>; origin: string } = {
  fake: createFakeGoogle(),
  origin: "",
}

export async function startWorld() {
  world.origin = await world.fake.listen(0)
}

export function memoryEnvironment(): BotConnectorEnvironment & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    workspace: "/home/bot/workspace",
    exec: () => Promise.reject(new Error("no exec here")),
    spawn: () => Promise.reject(new Error("no spawn here")),
    async readFile(path) {
      const data = files.get(path)
      if (data === undefined) throw new Error(`no such file ${path}`)
      return data
    },
    async writeFile(path, data) {
      files.set(path, data)
    },
  }
}

export function googleSetup() {
  const endpoints = developmentEndpoints(world.origin)
  const google = createGoogle(endpoints)
  const own = createOwnChanges(Date.now, 60_000)
  const environment = memoryEnvironment()
  const setup = connectionsSetup({
    providers: [googleProvider(endpoints, (url, init) => fetch(url, init))],
    connectors: [gmailConnector(google), calendarConnector(google, own)],
    fetch: (url, init) => fetch(url, init),
    environment,
  })
  return { ...setup, environment }
}

export async function signIn(
  setup: ReturnType<typeof googleSetup>,
  email: string,
  request: Record<string, unknown> = {},
) {
  await setup.panel.configureClient(OWNER, "google", {
    clientId: world.fake.client.id,
    clientSecret: { op: "set", value: world.fake.client.secret },
  })
  const authorization = await setup.panel.authorize(OWNER, {
    provider: "google",
    services: ["gmail", "gcal"],
    origin: "https://dsh.example",
    botId: "b1",
    ...request,
  })
  const consent = await fetch(authorization.url)
  expect(consent.status).toBe(200)
  const approve = new URL(`${world.origin}/o/oauth2/v2/approve`)
  for (const [key, value] of new URL(authorization.url).searchParams)
    approve.searchParams.set(key, value)
  approve.searchParams.set("account", email)
  const redirect = await fetch(approve, { redirect: "manual" })
  const back = new URL(redirect.headers.get("location") ?? "")
  expect(back.origin + back.pathname).toBe("https://dsh.example/bot-core/oauth/callback")
  return setup.signIn.callback(back.searchParams)
}

export function connectorOf(setup: ReturnType<typeof googleSetup>, id: string) {
  const connector = setup.catalog.get(id)
  if (connector === undefined) throw new Error(`${id} is not registered`)
  return connector
}

export async function ready(setup: ReturnType<typeof googleSetup>) {
  await setup.settings.configure("b1", connectorOf(setup, "gmail"), {
    enabled: true,
    values: {},
    events: "queue",
  })
  await setup.settings.configure("b1", connectorOf(setup, "gcal"), {
    enabled: true,
    values: {},
    events: "queue",
  })
  await settle()
}

export const call = (connectorId: string, tool: string, args: Record<string, unknown>) => ({
  botId: "b1",
  sessionId: "main-1",
  connectorId,
  tool,
  args: args as never,
})
export const signal = () => new AbortController().signal

export async function ask(setup: ReturnType<typeof googleSetup>, request: ReturnType<typeof call>) {
  const before = setup.ledger.list("b1").length
  const pending = setup.broker.call(request, signal())
  let failure: unknown
  pending.catch((error: unknown) => {
    failure = error
  })
  for (
    let i = 0;
    i < 200 && setup.ledger.list("b1").length === before && failure === undefined;
    i += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await setup.clock.advance(11 * 60_000)
  return pending
}

export async function approve(setup: ReturnType<typeof googleSetup>, actionId: string) {
  await setup.broker.recordDecision({
    botId: "b1",
    actionId,
    decision: "approve",
    origin: { kind: "web" },
  })
  for (let i = 0; i < 50; i += 1) {
    await settle()
    const state = setup.ledger.get(actionId)?.status.state
    if (state !== "approved" && state !== "executing") break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const action = setup.ledger.get(actionId)
  return action
}
