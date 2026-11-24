/** Google's OAuth scopes the connectors ask for (docs/specs/bot-connectors.md 9, 10). */
export const IDENTITY_SCOPES = ["openid", "email", "profile"] as const

/**
 * Gmail: read, label, draft, send and trash (gmail.modify, never permanent
 * deletion) and the filters (gmail.settings.basic, which the filter tools need).
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
] as const

/** Calendar: events, the calendar list (read only) and free/busy. */
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
] as const
