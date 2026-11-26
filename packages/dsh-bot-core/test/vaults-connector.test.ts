import { describe, expect, it } from "vitest"
import {
  type BotConnector,
  type BotConnectorRun,
  defineConnectorTool,
} from "../src/connector-contract"
import { createConnectorCatalog } from "../src/host/connectors/catalog"
import { createConnectorRuns } from "../src/host/connectors/runs"
import type { BotVaultAccess } from "../src/vault-contract"

const tool = (name: string, vault?: true) =>
  defineConnectorTool({
    name,
    description: name,
    permission: "ask",
    parameters: {},
    ...(vault === undefined ? {} : { vault }),
    preview: () => ({ title: name, fields: [] }),
    execute: async () => ({ text: "ok" }),
  })

const connector = (tools: BotConnector["tools"]): BotConnector => ({
  id: "probe",
  name: "Probe",
  sessions: "bot",
  tools,
})

describe("connector tools that fill logins", () => {
  it("are checked when registered", () => {
    const catalog = createConnectorCatalog()
    expect(() =>
      catalog.register(connector([{ ...tool("fill"), vault: false as unknown as true }])),
    ).toThrow("has a vault that is not true")
    expect(() =>
      catalog.register(
        connector([
          { ...tool("fill", true), snapshot: async () => ({}) } as BotConnector["tools"][number],
        ]),
      ),
    ).toThrow("may not reach the logins")
    expect(() => catalog.register(connector([tool("fill", true), tool("read")]))).not.toThrow()
  })

  it("get the bot's logins only when they declare vault", async () => {
    const catalog = createConnectorCatalog()
    catalog.register(connector([tool("fill", true), tool("read")]))
    const seen: { botId: string; connector: string; tool: string; sessionId?: string }[] = []
    const access = {} as BotVaultAccess
    let released = 0
    const runs = createConnectorRuns({
      bot: (botId) => ({ id: botId, name: "Mia" }),
      settings: { view: () => ({ values: {} }) as never },
      environment: () => ({}) as never,
      attachments: { get: async () => undefined },
      images: () =>
        ({ images: { admit: async () => ({ ok: false, reason: "no" }) }, refs: () => [] }) as never,
      connection: () => ({}) as never,
      senders: () => ({}) as never,
      vault(context) {
        seen.push({
          botId: context.botId,
          connector: context.connector,
          tool: context.tool,
          ...(context.sessionId === undefined ? {} : { sessionId: context.sessionId }),
        })
        return {
          access,
          release() {
            released += 1
          },
        }
      },
    })
    const signal = new AbortController().signal
    const fill = catalog.tool("probe", "fill")
    const read = catalog.tool("probe", "read")
    if (fill === undefined || read === undefined) throw new Error("not registered")
    const prepared = await runs.prepare("a", fill, { kind: "call" }, signal, {
      kind: "execute",
      callerSessionId: "s1",
    })
    const filled: BotConnectorRun<unknown> = prepared.run
    const plain: BotConnectorRun<unknown> = (
      await runs.prepare("a", read, { kind: "call" }, signal, {
        kind: "execute",
        callerSessionId: "s1",
      })
    ).run
    const snapshot: BotConnectorRun<unknown> = (
      await runs.prepare("a", fill, { kind: "call" }, signal, {
        kind: "snapshot",
        callerSessionId: "s1",
      })
    ).run
    expect(filled.vault).toBe(access)
    expect(plain.vault).toBeUndefined()
    expect(snapshot.vault).toBeUndefined()
    prepared.release()
    expect(released).toBe(1)
    expect(seen).toEqual([{ botId: "a", connector: "probe", tool: "probe_fill", sessionId: "s1" }])
  })
})
