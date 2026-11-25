import { DEFAULT_BOT_ENVIRONMENT_SPEC, environmentShortfall } from "../src/shared/environment"
/**
 * The connectors of docs/specs/bot-connectors.md (9) fitted to the contract:
 * the desktop and browser connectors as their packages define them, and
 * the others' tools and default permissions as definitions the catalog
 * accepts. Type-level and registration only; nothing here ships.
 */

import {
  createBrowserConnector,
  GENERATED_SERVER,
  readBrowserInstallation,
} from "@1outres/dsh-bot-connector-browser"
import {
  createDesktopConnector,
  DesktopControl,
  readVmSources,
} from "@1outres/dsh-bot-connector-desktop"
import { describe, expect, it } from "vitest"
import {
  type BotConnector,
  type BotConnectorToolDefinition,
  connectorTools,
} from "../src/connector-contract"
import type { ConnectorPermission } from "../src/contract"
import { createConnectorCatalog } from "../src/host/connectors/catalog"
import { VAULT_KIT } from "../src/vault-bytes"

/** The spec's browser table (9): every listed tool allow, run_code_unsafe disallow. */
const BROWSER_ALLOWED = [
  "navigate",
  "navigate_back",
  "wait_for",
  "snapshot",
  "find",
  "take_screenshot",
  "console_messages",
  "network_requests",
  "network_request",
  "click",
  "type",
  "fill_form",
  "press_key",
  "select_option",
  "hover",
  "drag",
  "handle_dialog",
  "file_upload",
  "drop",
  "tabs",
  "resize",
  "emulate_media",
  "evaluate",
  "pdf_save",
  "mouse_click_xy",
  "mouse_move_xy",
  "mouse_drag_xy",
  "mouse_down",
  "mouse_up",
  "mouse_wheel",
  "fill_credential",
  "use_passkey",
]

const mailTools = connectorTools()
const googleTool = (
  prefix: string,
  name: string,
  permission: ConnectorPermission,
  withSnapshot = false,
): BotConnectorToolDefinition =>
  mailTools.tool({
    name,
    description: `${prefix} ${name}.`,
    parameters: { id: { type: "string" } },
    permission,
    ...(permission === "ask" ? { ask: { waitMs: 60_000, ttlMs: 24 * 3_600_000 } } : {}),
    ...(withSnapshot ? { snapshot: async (args) => ({ subject: `Re: ${args.id ?? ""}` }) } : {}),
    preview: (_args, snapshot) => ({
      title: `${name}?`,
      fields: [
        ...(snapshot === undefined ? [] : [{ label: "Subject", value: JSON.stringify(snapshot) }]),
      ],
    }),
    async execute() {
      return { data: { done: true } }
    },
  })

const GMAIL: [string, ConnectorPermission, boolean?][] = [
  ...[
    "search",
    "get_thread",
    "get_message",
    "get_attachment",
    "list_labels",
    "modify_labels",
    "create_label",
    "update_label",
    "list_drafts",
    "get_draft",
    "create_draft",
    "update_draft",
    "list_filters",
  ].map((name) => [name, "allow"] as [string, ConnectorPermission]),
  ["send", "ask"],
  ["reply", "ask", true],
  ["forward", "ask", true],
  ...["trash", "untrash", "delete_draft", "delete_label", "create_filter", "delete_filter"].map(
    (name) => [name, "ask"] as [string, ConnectorPermission],
  ),
]
/** The accounts and events of the Google connectors; bot-core adds accounts, events_list and events_ack. */
const googleAccounts = (scope: string) => ({
  connections: { provider: "google", scopes: [scope] },
  events: {
    kinds: [{ kind: "changed", label: { en: "Changed" } }],
    delivery: "notify" as const,
    intervalMs: 60_000,
    poll: async () => ({ events: [], cursor: null }),
  },
})

const gmail: BotConnector = {
  id: "gmail",
  name: "Gmail",
  sessions: "main",
  ...googleAccounts("gmail.modify"),
  tools: GMAIL.map(([name, permission, snapshot]) =>
    googleTool("Gmail", name, permission, snapshot),
  ),
}

const GCAL: [string, ConnectorPermission][] = [
  ...[
    "list_calendars",
    "list_events",
    "get_event",
    "search_events",
    "freebusy",
    "create_personal_event",
    "update_personal_event",
  ].map((name) => [name, "allow"] as [string, ConnectorPermission]),
  ...["create_event_with_attendees", "update_event", "delete_event", "respond"].map(
    (name) => [name, "ask"] as [string, ConnectorPermission],
  ),
]
const gcal: BotConnector = {
  id: "gcal",
  name: "Google Calendar",
  sessions: "main",
  ...googleAccounts("calendar.events"),
  tools: GCAL.map(([name, permission]) => googleTool("Calendar", name, permission)),
}

describe("the spec's connectors fit the contract", () => {
  it("registers desktop, browser, Gmail and Calendar with the tool tables of the spec", async () => {
    const desktop = createDesktopConnector({
      sources: await readVmSources(),
      control: new DesktopControl(() => 0),
      deadline: (ms) => AbortSignal.timeout(ms),
      now: () => 0,
    })
    const browser = createBrowserConnector({
      generated: GENERATED_SERVER,
      installation: await readBrowserInstallation(),
      kit: VAULT_KIT,
      mark: () => "0".repeat(32),
      deadline: (ms) => AbortSignal.timeout(ms),
    })
    const catalog = createConnectorCatalog()
    for (const connector of [desktop, browser, gmail, gcal])
      catalog.register(connector as BotConnector<unknown>)
    const permission = (id: string, tool: string) => catalog.tool(id, tool)?.tool.permission
    expect(
      catalog
        .tools()
        .filter((entry) => entry.connector.id === "desktop")
        .every(
          (entry) =>
            entry.tool.permission === "allow" &&
            entry.tool.exclusive ===
              (entry.tool.name === "request_handoff" ? undefined : "display"),
        ),
    ).toBe(true)
    expect(catalog.get("desktop")?.panel?.streams.map((stream) => stream.name)).toEqual(["screen"])
    expect(catalog.tool("desktop", "sheet")?.name).toBe("desktop_sheet")
    expect(catalog.get("desktop")?.sessions).toBe("bot")
    expect(permission("browser", "run_code_unsafe")).toBe("disallow")
    expect(permission("browser", "file_upload")).toBe("allow")
    expect(catalog.tool("browser", "close")).toBeUndefined()
    expect(catalog.tool("browser", "install")).toBeUndefined()
    const browserTools = catalog.tools().filter((entry) => entry.connector.id === "browser")
    expect(
      browserTools
        .filter((entry) => entry.tool.permission === "allow")
        .map((entry) => entry.tool.name)
        .sort(),
    ).toEqual([...BROWSER_ALLOWED].sort())
    expect(
      browserTools
        .filter((entry) => entry.tool.vault !== true)
        .every((entry) => entry.maxResultChars === 128_000),
    ).toBe(true)
    expect(
      browserTools
        .filter((entry) => entry.tool.vault === true)
        .map((entry) => entry.tool.name)
        .sort(),
    ).toEqual(["fill_credential", "use_passkey"])
    expect(catalog.get("browser")).toMatchObject({
      sessions: "bot",
      minimumSpec: { memoryMiB: 3072 },
      requires: ["desktop"],
      creationOption: "workstation",
    })
    expect(permission("gmail", "send")).toBe("ask")
    expect(catalog.tool("gmail", "reply")?.tool.snapshot).toBeTypeOf("function")
    expect(permission("gmail", "modify_labels")).toBe("allow")
    expect(permission("gcal", "delete_event")).toBe("ask")
    expect(catalog.get("desktop")?.minimumSpec).toEqual({ memoryMiB: 4096 })
    // A new bot's spec gives every connector what it needs, so creating one with the workstation on passes the gate.
    expect(
      catalog
        .list()
        .every(
          (connector) =>
            environmentShortfall(connector.minimumSpec ?? {}, DEFAULT_BOT_ENVIRONMENT_SPEC) ===
            undefined,
        ),
    ).toBe(true)
    expect(catalog.tools().every((entry) => entry.name.length <= 64)).toBe(true)
    expect(catalog.tool("gmail", "send")?.schema).toMatchObject({ required: ["account"] })
  })
})
