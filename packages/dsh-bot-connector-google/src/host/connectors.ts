import type { BotConnector } from "@1outres/dsh-bot-core"
import { calendarEvents } from "./calendar/events"
import type { OwnChanges } from "./calendar/own"
import { calendarTools } from "./calendar/tools"
import { gmailEvents } from "./gmail/events"
import { gmailTools } from "./gmail/tools"
import type { Google } from "./google"
import { GOOGLE_PROVIDER } from "./provider"
import { CALENDAR_SCOPES, GMAIL_SCOPES } from "./scopes"

/** Gmail (docs/specs/bot-connectors.md 9): the bot's Main session acts as the Google accounts assigned to it. */
export function gmailConnector(google: Google): BotConnector {
  return {
    id: "gmail",
    name: "Gmail",
    description: {
      en: "Read, label and draft email as the bot's Google accounts; sending, replying, forwarding, trash and filters ask you first.",
      ja: "ボットの Google アカウントとしてメールを読み、ラベルを付け、下書きします。送信・返信・転送・ゴミ箱・フィルタは先に確認します。",
    },
    sessions: "main",
    connections: { provider: GOOGLE_PROVIDER, scopes: [...GMAIL_SCOPES] },
    events: gmailEvents(google),
    tools: gmailTools(google),
  }
}

/** Google Calendar: events without guests run at once; invitations, changes others see and answers ask first. */
export function calendarConnector(google: Google, own: OwnChanges): BotConnector {
  return {
    id: "gcal",
    name: "Google Calendar",
    description: {
      en: "Read calendars, check free time and keep personal events as the bot's Google accounts; anything guests see asks you first.",
      ja: "ボットの Google アカウントとして予定を読み、空き時間を調べ、参加者のいない予定を管理します。参加者に届く操作は先に確認します。",
    },
    sessions: "main",
    connections: { provider: GOOGLE_PROVIDER, scopes: [...CALENDAR_SCOPES] },
    events: calendarEvents(google, own),
    tools: calendarTools(google, own),
  }
}
