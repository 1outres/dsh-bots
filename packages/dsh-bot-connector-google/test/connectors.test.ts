import { describe, expect, it } from "vitest"
import { brokerSetup } from "../../dsh-bot-core/test/connectors-support"
import { createOwnChanges } from "../src/host/calendar/own"
import { calendarConnector, gmailConnector } from "../src/host/connectors"
import { GOOGLE_ENDPOINTS } from "../src/host/endpoints"
import { createGoogle } from "../src/host/google"
import { CALENDAR_SCOPES, GMAIL_SCOPES } from "../src/host/scopes"

const google = createGoogle(GOOGLE_ENDPOINTS)

const SPEC = {
  gmail: {
    allow: [
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
    ],
    ask: [
      "send",
      "reply",
      "forward",
      "trash",
      "untrash",
      "delete_draft",
      "delete_label",
      "create_filter",
      "delete_filter",
    ],
  },
  gcal: {
    allow: [
      "list_calendars",
      "list_events",
      "get_event",
      "search_events",
      "freebusy",
      "create_personal_event",
      "update_personal_event",
    ],
    ask: ["create_event_with_attendees", "update_event", "delete_event", "respond"],
  },
} as const

describe("the Google connectors", () => {
  it("have the spec's tools and default permissions, and bot-core adds accounts and the event tools", () => {
    const { catalog } = brokerSetup()
    const connectors = [
      gmailConnector(google),
      calendarConnector(google, createOwnChanges(Date.now, 1)),
    ]
    for (const connector of connectors) catalog.register(connector)
    for (const connector of connectors) {
      const spec = SPEC[connector.id as keyof typeof SPEC]
      const byPermission = (permission: string) =>
        connector.tools
          .filter((tool) => tool.permission === permission)
          .map((tool) => tool.name)
          .sort()
      expect(byPermission("allow")).toEqual([...spec.allow].sort())
      expect(byPermission("ask")).toEqual([...spec.ask].sort())
      expect(byPermission("disallow")).toEqual([])
      expect(connector.sessions).toBe("main")
      expect(connector.minimumSpec).toBeUndefined()
      expect(connector.preparation).toBeUndefined()
    }
    for (const name of [
      "send_draft",
      "delete_message",
      "vacation",
      "send_as",
      "quick_add",
      "delete_calendar",
    ]) {
      expect(catalog.tools().some((entry) => entry.tool.name === name)).toBe(false)
    }
    for (const tool of [
      "reply",
      "forward",
      "trash",
      "untrash",
      "delete_draft",
      "delete_label",
      "delete_filter",
    ]) {
      expect(catalog.tool("gmail", tool)?.tool.snapshot).toBeTypeOf("function")
    }
    for (const tool of ["update_event", "delete_event", "respond"]) {
      expect(catalog.tool("gcal", tool)?.tool.snapshot).toBeTypeOf("function")
    }
  })

  it("ask for Gmail (modify and filters) and Calendar (events, the calendar list, free/busy) only", () => {
    expect(gmailConnector(google).connections).toEqual({
      provider: "google",
      scopes: [...GMAIL_SCOPES],
    })
    expect(GMAIL_SCOPES).not.toContain("https://mail.google.com/")
    expect(calendarConnector(google, createOwnChanges(Date.now, 1)).connections?.scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.freebusy",
    ])
    expect(CALENDAR_SCOPES).toHaveLength(3)
  })
})
