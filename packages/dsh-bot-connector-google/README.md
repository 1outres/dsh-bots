# @1outres/dsh-bot-connector-google

Gmail and Google Calendar for the bots of DeepSeek Harness: two connectors (`gmail`, `gcal`) and the connection provider `google` they act through. Setting it up with a real Google account: [docs/google-connector-setup.md](../../docs/google-connector-setup.md). The design: [docs/specs/bot-connectors.md](../../docs/specs/bot-connectors.md) 9 and 10.

- **Accounts.** bot-core signs Google accounts in (OAuth 2.0 authorization code with PKCE, a Web application client, `access_type=offline`, `prompt=consent`) and keeps their refresh tokens in DSH's credential store on the Host. This package names Google's endpoints, the scopes and how an account is identified (`openidconnect.googleapis.com/v1/userinfo`). Every tool takes an `account` (its email or label); bot-core resolves it to one of the bot's assigned accounts and hands the tool `run.connection`. Nothing reaches the bot's VM.
- **Scopes.** Gmail: `gmail.modify` and `gmail.settings.basic` (the filter tools need it). Calendar: `calendar.events`, `calendar.calendarlist.readonly`, `calendar.freebusy`. Identity: `openid`, `email`, `profile`.
- **APIs.** `@googleapis/gmail` and `@googleapis/calendar` with a `google-auth-library` `OAuth2Client` that only carries bot-core's access token; a 401 asks bot-core for a fresh token once. Sending is an upload (`message/rfc822`) of a MIME message this package builds (`src/host/gmail/mime.ts`): UTF-8 `text/plain`, RFC 2047 headers, `multipart/mixed` for attachments. The preview a person approves and the MIME sent are made from one model (`src/host/gmail/compose.ts`); no signature or other text is added; arguments with line breaks are refused.

## Tools and default permissions

| Gmail                                                                                                                                                                                                             | Default | Calendar                                                                                                                                                        | Default |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| search, get_thread, get_message, get_attachment (saves to the VM), list_labels, modify_labels (never TRASH or SPAM), create_label, update_label, list_drafts, get_draft, create_draft, update_draft, list_filters | Allow   | list_calendars, list_events, get_event, search_events, freebusy, create_personal_event, update_personal_event (refuses events with guests or another organizer) | Allow   |
| send (attachments: files of the VM, snapshot of their sha256, checked again before sending)                                                                                                                       | Ask     | create_event_with_attendees                                                                                                                                     | Ask     |
| reply (snapshot: the original's headers and, with `quote`, its text; recheck: Message-ID, subject, sender, thread)                                                                                                | Ask     | update_event (snapshot of the event; recheck: its etag)                                                                                                         | Ask     |
| forward (snapshot: the original's text and, with `include_attachments`, its attachments' sha256)                                                                                                                  | Ask     | delete_event (snapshot, recheck)                                                                                                                                | Ask     |
| trash, untrash, delete_draft, delete_label, delete_filter (each with a snapshot of what it acts on), create_filter                                                                                                | Ask     | respond (snapshot, recheck; the organizer is told)                                                                                                              | Ask     |

bot-core adds `gmail_accounts` / `gcal_accounts` (Allow), and `*_events_list` / `*_events_ack` (Allow, Main) while the bot gets the events in a queue. Not built: permanent deletion, sending a draft, vacation replies, forwarding and send-as settings, quick add, calendar sharing.

## Events

- `gmail.message.received`: `users.history.list` (`messageAdded`, label `INBOX`) from the last `historyId`, every 60 s. The first poll stores `users.getProfile`'s `historyId`. A 404 (history gone) starts again from the profile and reports a gap.
- `gcal.event.created` / `updated` / `cancelled`: `events.list` with a sync token per calendar the account can write to, every 120 s. A calendar seen for the first time is synced to get its token; a 410 syncs it again and reports a gap. Changes the calendar tools made in this process within 30 minutes are marked `own` (kept, never told).

## Configuration

| Field                      | Default |                                                                                                                                                                                                                                  |
| -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `development.googleOrigin` | `""`    | **Development and tests only.** An origin that serves a fake Google under Google's paths (`dev/fake-google`). Empty uses Google. bot-core never refreshes a connection at another token endpoint than the one that signed it in. |

## Fake Google

`dev/fake-google` (repository root, never published): OAuth (an account picker), userinfo, and the Gmail and Calendar endpoints the tools call, in memory; `/_admin/deliver`, `/_admin/change-password`, `/_admin/expire-history`, `/_admin/calendar-event`, `/_admin/sent` play the outside world. `node dev/fake-google/cli.js --host <ip> --port <port>` prints the origin and the fake client id and secret. `test/google.test.ts` runs the connectors against it through bot-core's own modules.
