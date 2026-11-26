import { createHash, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { parseMime } from "./mime.js"

const b64url = (data) => Buffer.from(data).toString("base64url")
const html = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

export function createFakeGoogle(options = {}) {
  const client = {
    id: options.clientId ?? "fake-client.apps.googleusercontent.com",
    secret: options.clientSecret ?? "fake-secret",
  }
  const accessTokenSeconds = options.accessTokenSeconds ?? 3600
  const accounts = new Map()
  const codes = new Map()
  const refreshTokens = new Map()
  const accessTokens = new Map()
  const requests = []
  let counter = 0
  const id = (prefix) => `${prefix}${(++counter).toString(36)}${randomBytes(3).toString("hex")}`

  const addAccount = ({ sub, email, name }) => {
    const account = {
      sub,
      email,
      name,
      historyId: 1000,
      minHistoryId: 1000,
      history: [],
      messages: new Map(),
      labels: new Map([
        ["INBOX", { id: "INBOX", name: "INBOX", type: "system" }],
        ["UNREAD", { id: "UNREAD", name: "UNREAD", type: "system" }],
        ["STARRED", { id: "STARRED", name: "STARRED", type: "system" }],
        ["SENT", { id: "SENT", name: "SENT", type: "system" }],
        ["TRASH", { id: "TRASH", name: "TRASH", type: "system" }],
        ["SPAM", { id: "SPAM", name: "SPAM", type: "system" }],
        ["DRAFT", { id: "DRAFT", name: "DRAFT", type: "system" }],
      ]),
      drafts: new Map(),
      filters: new Map(),
      sent: [],
      calendars: new Map([
        [
          email,
          { id: email, summary: email, accessRole: "owner", primary: true, timeZone: "Asia/Tokyo" },
        ],
      ]),
      events: new Map(),
      changeSeq: 0,
      minSyncSeq: 0,
    }
    account.events.set(email, new Map())
    accounts.set(email, account)
    return account
  }
  for (const account of options.accounts ?? [
    { sub: "100000000000000000001", email: "alice@example.com", name: "Alice Example" },
    { sub: "100000000000000000002", email: "bob@example.com", name: "Bob Example" },
  ]) {
    addAccount(account)
  }

  const bumpHistory = (account, messagesAdded) => {
    account.historyId += 1
    if (messagesAdded.length > 0)
      account.history.push({ id: String(account.historyId), messagesAdded })
  }

  const store = (account, raw, labelIds, threadId) => {
    const parsed = parseMime(raw)
    const messageId = parsed.headers["message-id"] ?? `<${id("m")}@fake.google>`
    const message = {
      id: id("m"),
      threadId: threadId ?? id("t"),
      labelIds: [...labelIds],
      raw,
      parsed,
      messageId,
      internalDate: Date.now(),
      attachments: parsed.attachments.map((attachment, index) => ({
        ...attachment,
        attachmentId: `att${index}-${randomBytes(4).toString("hex")}`,
      })),
    }
    accounts.get(account.email).messages.set(message.id, message)
    bumpHistory(account, [
      { message: { id: message.id, threadId: message.threadId, labelIds: message.labelIds } },
    ])
    return message
  }

  const deliver = (email, { from, subject, text, to }) => {
    const account = accounts.get(email)
    if (account === undefined) throw new Error(`no account ${email}`)
    const raw = [
      `From: ${from}`,
      `To: ${to ?? email}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${id("in")}@sender.example>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(text).toString("base64"),
    ].join("\r\n")
    return store(account, raw, ["INBOX", "UNREAD"])
  }

  const payloadOf = (message, format) => {
    const headers = Object.entries(message.parsed.headers).map(([name, value]) => ({
      name: name
        .replace(/(^|-)([a-z])/g, (_, dash, char) => dash + char.toUpperCase())
        .replace("Message-Id", "Message-ID"),
      value,
    }))
    if (format === "metadata") return { mimeType: "text/plain", headers }
    const textPart = {
      partId: "0",
      mimeType: "text/plain",
      filename: "",
      headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }],
      body: { size: Buffer.byteLength(message.parsed.text), data: b64url(message.parsed.text) },
    }
    if (message.attachments.length === 0)
      return { ...textPart, headers: [...headers, ...textPart.headers] }
    return {
      mimeType: "multipart/mixed",
      headers,
      parts: [
        textPart,
        ...message.attachments.map((attachment, index) => ({
          partId: String(index + 1),
          mimeType: attachment.mimeType,
          filename: attachment.filename,
          headers: [],
          body: {
            size: attachment.data.length,
            attachmentId: `${attachment.attachmentId}.${randomBytes(3).toString("hex")}`,
          },
        })),
      ],
    }
  }
  const resource = (message, format = "full") => ({
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    snippet: message.parsed.text.slice(0, 100),
    internalDate: String(message.internalDate),
    historyId: String(0),
    payload: payloadOf(message, format),
  })

  const matches = (message, query) => {
    const words = (query ?? "").trim().split(/\s+/).filter(Boolean)
    const headers = message.parsed.headers
    return words.every((word) => {
      const [key, ...rest] = word.split(":")
      const value = rest.join(":").toLowerCase()
      if (rest.length === 0)
        return `${headers.subject ?? ""} ${headers.from ?? ""} ${message.parsed.text}`
          .toLowerCase()
          .includes(key.toLowerCase())
      switch (key) {
        case "is":
          return value === "unread"
            ? message.labelIds.includes("UNREAD")
            : value === "starred"
              ? message.labelIds.includes("STARRED")
              : true
        case "in":
        case "label":
          return message.labelIds.some((label) => label.toLowerCase() === value)
        case "from":
          return (headers.from ?? "").toLowerCase().includes(value)
        case "to":
          return (headers.to ?? "").toLowerCase().includes(value)
        case "subject":
          return (headers.subject ?? "").toLowerCase().includes(value)
        default:
          return true
      }
    })
  }

  const eventResource = (account, _calendarId, event) => {
    const attendees = (event.attendees ?? []).map((attendee) => ({
      ...attendee,
      ...(attendee.email === account.email ? { self: true } : {}),
    }))
    return {
      kind: "calendar#event",
      ...event,
      ...(event.attendees === undefined ? {} : { attendees }),
      organizer: {
        ...event.organizer,
        ...(event.organizer?.email === account.email ? { self: true } : {}),
      },
      htmlLink: `https://calendar.fake.google/event?eid=${event.id}`,
      calendarId: undefined,
    }
  }
  const changeEvent = (account, calendarId, event) => {
    account.changeSeq += 1
    const stamp = new Date().toISOString()
    const next = {
      ...event,
      seq: account.changeSeq,
      updated: stamp,
      etag: `"${account.changeSeq}"`,
    }
    account.events.get(calendarId).set(event.id, next)
    return next
  }
  const insertEvent = (account, calendarId, body, organizer) => {
    const now = new Date().toISOString()
    return changeEvent(account, calendarId, {
      id: id("ev"),
      status: "confirmed",
      created: now,
      summary: body.summary,
      description: body.description,
      location: body.location,
      start: body.start,
      end: body.end,
      attendees: body.attendees?.map((attendee) => ({
        email: attendee.email,
        responseStatus: attendee.responseStatus ?? "needsAction",
      })),
      organizer: { email: organizer },
    })
  }
  const eventStamp = (time) => Date.parse(time?.dateTime ?? `${time?.date}T00:00:00Z`)

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(body === undefined ? "" : JSON.stringify(body))
  }
  const fail = (res, status, message) => json(res, status, { error: { code: status, message } })
  const oauthFail = (res, error, description) =>
    json(res, 400, { error, ...(description ? { error_description: description } : {}) })

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = []
      req.on("data", (chunk) => chunks.push(chunk))
      req.on("end", () => resolve(Buffer.concat(chunks)))
      req.on("error", reject)
    })

  const accountOf = (req) => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1]
    const entry = token === undefined ? undefined : accessTokens.get(token)
    if (entry === undefined || entry.expiresAt < Date.now()) return undefined
    return accounts.get(entry.email)
  }

  const multipartRelated = (body, type) => {
    const boundary = /boundary=([^;]+)/.exec(type)?.[1]
    const parts = body.toString("utf8").split(`--${boundary}`).slice(1, -1)
    return parts.map((part) => {
      const at = part.indexOf("\r\n\r\n")
      return part.slice(at + 4).replace(/\r\n$/, "")
    })
  }

  const authorizePage = (url) => {
    const params = url.searchParams
    const hidden = [
      "client_id",
      "redirect_uri",
      "state",
      "scope",
      "code_challenge",
      "code_challenge_method",
    ]
      .map((name) => `<input type="hidden" name="${name}" value="${html(params.get(name) ?? "")}">`)
      .join("")
    const choices = [...accounts.values()]
      .map(
        (account) =>
          `<button name="account" value="${html(account.email)}" data-account="${html(account.email)}">Continue as ${html(account.name)} (${html(account.email)})</button><br>`,
      )
      .join("")
    return `<!doctype html><html><head><meta charset="utf-8"><title>Fake Google sign-in</title></head><body style="font:16px system-ui;max-width:40rem;margin:3rem auto">
<h1>Fake Google — choose an account</h1><p>This is a development stand-in for Google. Scopes requested:</p><pre>${html((params.get("scope") ?? "").split(" ").join("\n"))}</pre>
<form method="get" action="/o/oauth2/v2/approve">${hidden}${choices}<br><button name="deny" value="1" data-deny="">Cancel</button></form></body></html>`
  }

  const handle = async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake")
    const path = url.pathname
    const method = req.method ?? "GET"
    const body = method === "GET" || method === "DELETE" ? Buffer.alloc(0) : await readBody(req)
    const form = () => Object.fromEntries(new URLSearchParams(body.toString("utf8")))
    const data = () => (body.length === 0 ? {} : JSON.parse(body.toString("utf8")))
    requests.push({ method, path, query: url.search })

    if (path === "/o/oauth2/v2/auth") {
      if (url.searchParams.get("client_id") !== client.id) return fail(res, 400, "invalid_client")
      if (url.searchParams.get("code_challenge_method") !== "S256")
        return fail(res, 400, "PKCE S256 required")
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return res.end(authorizePage(url))
    }
    if (path === "/o/oauth2/v2/approve") {
      const params = url.searchParams
      const redirect = new URL(params.get("redirect_uri") ?? "")
      if (params.get("deny")) {
        redirect.searchParams.set("error", "access_denied")
      } else {
        const code = id("code-")
        codes.set(code, {
          email: params.get("account"),
          scope: params.get("scope") ?? "",
          redirectUri: params.get("redirect_uri"),
          challenge: params.get("code_challenge"),
        })
        redirect.searchParams.set("code", code)
      }
      redirect.searchParams.set("state", params.get("state") ?? "")
      res.writeHead(302, { location: redirect.href })
      return res.end()
    }
    if (path === "/token" && method === "POST") {
      const params = form()
      if (params.client_id !== client.id || params.client_secret !== client.secret)
        return oauthFail(res, "invalid_client")
      if (params.grant_type === "authorization_code") {
        const code = codes.get(params.code)
        codes.delete(params.code)
        if (code === undefined || code.redirectUri !== params.redirect_uri)
          return oauthFail(res, "invalid_grant", "Bad code")
        if (
          b64url(
            createHash("sha256")
              .update(params.code_verifier ?? "")
              .digest(),
          ) !== code.challenge
        ) {
          return oauthFail(res, "invalid_grant", "PKCE verification failed")
        }
        const refresh = id("1//refresh-")
        const access = id("ya29.access-")
        refreshTokens.set(refresh, { email: code.email, scope: code.scope })
        accessTokens.set(access, {
          email: code.email,
          expiresAt: Date.now() + accessTokenSeconds * 1000,
        })
        return json(res, 200, {
          access_token: access,
          expires_in: accessTokenSeconds,
          refresh_token: refresh,
          scope: code.scope,
          token_type: "Bearer",
        })
      }
      if (params.grant_type === "refresh_token") {
        const grant = refreshTokens.get(params.refresh_token)
        if (grant === undefined)
          return oauthFail(res, "invalid_grant", "Token has been expired or revoked.")
        const access = id("ya29.access-")
        accessTokens.set(access, {
          email: grant.email,
          expiresAt: Date.now() + accessTokenSeconds * 1000,
        })
        return json(res, 200, {
          access_token: access,
          expires_in: accessTokenSeconds,
          scope: grant.scope,
          token_type: "Bearer",
        })
      }
      return oauthFail(res, "unsupported_grant_type")
    }
    if (path === "/revoke" && method === "POST") {
      const token = form().token
      refreshTokens.delete(token)
      return json(res, 200, {})
    }
    if (path.startsWith("/_admin/")) return admin(path, method, data(), url, res)

    const account = accountOf(req)
    if (account === undefined)
      return fail(res, 401, "Request had invalid authentication credentials.")
    if (path === "/v1/userinfo") {
      return json(res, 200, {
        sub: account.sub,
        email: account.email,
        email_verified: true,
        name: account.name,
      })
    }
    const gmail = /^\/(upload\/)?gmail\/v1\/users\/me\/(.*)$/.exec(path)
    if (gmail) return gmailApi(account, gmail[2], method, body, req, url, res, data)
    const calendar = /^\/calendar\/v3\/(.*)$/.exec(path)
    if (calendar) return calendarApi(account, calendar[1], method, data, url, res)
    return fail(res, 404, `no route ${method} ${path}`)
  }

  const gmailApi = (account, rest, method, body, req, url, res, data) => {
    const params = url.searchParams
    const segments = rest.split("/").map(decodeURIComponent)
    const message = (messageId) => account.messages.get(messageId)
    if (rest === "profile")
      return json(res, 200, { emailAddress: account.email, historyId: String(account.historyId) })
    if (rest === "messages" && method === "GET") {
      const labels = params.getAll("labelIds")
      const max = Number(params.get("maxResults") ?? 100)
      const includeSpamTrash = params.get("includeSpamTrash") === "true"
      const found = [...account.messages.values()]
        .reverse()
        .filter((item) => labels.every((label) => item.labelIds.includes(label)))
        .filter(
          (item) =>
            includeSpamTrash ||
            !item.labelIds.some((label) => label === "TRASH" || label === "SPAM"),
        )
        .filter((item) => matches(item, params.get("q")))
      return json(res, 200, {
        messages: found.slice(0, max).map((item) => ({ id: item.id, threadId: item.threadId })),
        resultSizeEstimate: found.length,
      })
    }
    if (rest === "messages/send" && method === "POST") {
      const [metadata, raw] = multipartRelated(body, req.headers["content-type"] ?? "")
      const { threadId } = JSON.parse(metadata ?? "{}")
      const sent = store(account, raw, ["SENT"], threadId)
      account.sent.push({ id: sent.id, threadId: sent.threadId, raw })
      return json(res, 200, { id: sent.id, threadId: sent.threadId, labelIds: sent.labelIds })
    }
    if (rest === "messages/batchModify" && method === "POST") {
      const { ids = [], addLabelIds = [], removeLabelIds = [] } = data()
      for (const messageId of ids) {
        const item = message(messageId)
        if (item === undefined) return fail(res, 404, "Requested entity was not found.")
        item.labelIds = [
          ...new Set([
            ...item.labelIds.filter((label) => !removeLabelIds.includes(label)),
            ...addLabelIds,
          ]),
        ]
      }
      bumpHistory(account, [])
      res.writeHead(204)
      return res.end()
    }
    if (segments[0] === "messages" && segments[1] !== undefined) {
      const item = message(segments[1])
      if (item === undefined) return fail(res, 404, "Requested entity was not found.")
      if (segments[2] === "attachments") {
        const attachment = item.attachments.find((entry) =>
          segments[3].startsWith(`${entry.attachmentId}.`),
        )
        if (attachment === undefined) return fail(res, 404, "Requested entity was not found.")
        return json(res, 200, { size: attachment.data.length, data: b64url(attachment.data) })
      }
      if (segments[2] === "trash")
        item.labelIds = [...item.labelIds.filter((label) => label !== "INBOX"), "TRASH"]
      if (segments[2] === "untrash")
        item.labelIds = [...item.labelIds.filter((label) => label !== "TRASH"), "INBOX"]
      return json(res, 200, resource(item, params.get("format") ?? "full"))
    }
    if (segments[0] === "threads" && segments[1] !== undefined) {
      const messages = [...account.messages.values()].filter(
        (item) => item.threadId === segments[1],
      )
      if (messages.length === 0) return fail(res, 404, "Requested entity was not found.")
      return json(res, 200, { id: segments[1], messages: messages.map((item) => resource(item)) })
    }
    if (segments[0] === "labels") {
      if (segments[1] === undefined && method === "GET")
        return json(res, 200, { labels: [...account.labels.values()] })
      if (segments[1] === undefined && method === "POST") {
        const label = { id: id("Label_"), name: data().name, type: "user" }
        account.labels.set(label.id, label)
        return json(res, 200, label)
      }
      const label = account.labels.get(segments[1])
      if (label === undefined) return fail(res, 404, "Requested entity was not found.")
      if (method === "PATCH") Object.assign(label, { name: data().name })
      if (method === "DELETE") {
        account.labels.delete(label.id)
        res.writeHead(204)
        return res.end()
      }
      return json(res, 200, {
        ...label,
        messagesTotal: [...account.messages.values()].filter((item) =>
          item.labelIds.includes(label.id),
        ).length,
      })
    }
    if (segments[0] === "drafts") {
      const draftResource = (draft) => ({ id: draft.id, message: resource(draft.message) })
      if (segments[1] === undefined && method === "GET")
        return json(res, 200, {
          drafts: [...account.drafts.values()].map((draft) => ({
            id: draft.id,
            message: { id: draft.message.id, threadId: draft.message.threadId },
          })),
        })
      if (segments[1] === undefined && method === "POST") {
        const { message: input } = data()
        const stored = store(
          account,
          Buffer.from(input.raw, "base64url").toString("utf8"),
          ["DRAFT"],
          input.threadId,
        )
        const draft = { id: id("r"), message: stored }
        account.drafts.set(draft.id, draft)
        return json(res, 200, draftResource(draft))
      }
      const draft = account.drafts.get(segments[1])
      if (draft === undefined) return fail(res, 404, "Requested entity was not found.")
      if (method === "PUT") {
        const { message: input } = data()
        draft.message = store(
          account,
          Buffer.from(input.raw, "base64url").toString("utf8"),
          ["DRAFT"],
          input.threadId,
        )
      }
      if (method === "DELETE") {
        account.drafts.delete(draft.id)
        res.writeHead(204)
        return res.end()
      }
      return json(res, 200, draftResource(draft))
    }
    if (segments[0] === "settings" && segments[1] === "filters") {
      if (segments[2] === undefined && method === "GET")
        return json(res, 200, { filter: [...account.filters.values()] })
      if (segments[2] === undefined && method === "POST") {
        const filter = { id: id("ANe1Bm"), ...data() }
        account.filters.set(filter.id, filter)
        return json(res, 200, filter)
      }
      const filter = account.filters.get(segments[2])
      if (filter === undefined) return fail(res, 404, "Requested entity was not found.")
      if (method === "DELETE") {
        account.filters.delete(filter.id)
        res.writeHead(204)
        return res.end()
      }
      return json(res, 200, filter)
    }
    if (rest === "history") {
      const start = Number(params.get("startHistoryId"))
      if (start < account.minHistoryId) return fail(res, 404, "Requested entity was not found.")
      const label = params.get("labelId")
      const history = account.history
        .filter((entry) => Number(entry.id) > start)
        .map((entry) => ({
          id: entry.id,
          messagesAdded: entry.messagesAdded.filter(
            (added) => label === null || added.message.labelIds.includes(label),
          ),
        }))
        .filter((entry) => entry.messagesAdded.length > 0)
      return json(res, 200, { history, historyId: String(account.historyId) })
    }
    return fail(res, 404, `no Gmail route ${method} ${rest}`)
  }

  const calendarApi = (account, rest, method, data, url, res) => {
    const params = url.searchParams
    const segments = rest.split("/").map(decodeURIComponent)
    if (rest === "users/me/calendarList") {
      return json(res, 200, { items: [...account.calendars.values()] })
    }
    if (rest === "freeBusy" && method === "POST") {
      const { timeMin, timeMax, items = [] } = data()
      const calendars = {}
      for (const { id: calendarId } of items) {
        const key = calendarId === "primary" ? account.email : calendarId
        const events = [...(account.events.get(key)?.values() ?? [])].filter(
          (event) => event.status !== "cancelled",
        )
        calendars[calendarId] = {
          busy: events
            .filter(
              (event) =>
                eventStamp(event.end) > Date.parse(timeMin) &&
                eventStamp(event.start) < Date.parse(timeMax),
            )
            .map((event) => ({
              start: event.start.dateTime ?? event.start.date,
              end: event.end.dateTime ?? event.end.date,
            })),
        }
      }
      return json(res, 200, { calendars })
    }
    if (segments[0] !== "calendars" || segments[2] !== "events")
      return fail(res, 404, `no Calendar route ${rest}`)
    const calendarId = segments[1] === "primary" ? account.email : segments[1]
    const events = account.events.get(calendarId)
    if (events === undefined) return fail(res, 404, "Not Found")
    const eventId = segments[3]
    if (eventId === undefined && method === "GET") {
      const syncToken = params.get("syncToken")
      if (syncToken !== null) {
        const since = Number(syncToken.slice(1))
        if (since < account.minSyncSeq)
          return fail(res, 410, "Sync token is no longer valid, a full sync is required.")
        const items = [...events.values()]
          .filter((event) => event.seq > since)
          .map((event) => eventResource(account, calendarId, event))
        return json(res, 200, { items, nextSyncToken: `s${account.changeSeq}` })
      }
      const showDeleted = params.get("showDeleted") === "true"
      const query = (params.get("q") ?? "").toLowerCase()
      const min = params.get("timeMin")
      const max = params.get("timeMax")
      const items = [...events.values()]
        .filter((event) => showDeleted || event.status !== "cancelled")
        .filter(
          (event) =>
            query === "" ||
            `${event.summary ?? ""} ${event.description ?? ""} ${event.location ?? ""}`
              .toLowerCase()
              .includes(query),
        )
        .filter((event) => min === null || eventStamp(event.end) > Date.parse(min))
        .filter((event) => max === null || eventStamp(event.start) < Date.parse(max))
        .sort((a, b) => eventStamp(a.start) - eventStamp(b.start))
        .map((event) => eventResource(account, calendarId, event))
      return json(res, 200, { items, nextSyncToken: `s${account.changeSeq}` })
    }
    if (eventId === undefined && method === "POST") {
      const event = insertEvent(account, calendarId, data(), account.email)
      return json(res, 200, eventResource(account, calendarId, event))
    }
    const event = events.get(eventId)
    if (event === undefined) return fail(res, 404, "Not Found")
    if (method === "GET") return json(res, 200, eventResource(account, calendarId, event))
    if (method === "PATCH") {
      const changes = data()
      const next = changeEvent(account, calendarId, {
        ...event,
        ...changes,
        ...(changes.attendees === undefined
          ? {}
          : {
              attendees: changes.attendees.map(({ self: _self, ...attendee }) => ({
                responseStatus: "needsAction",
                ...attendee,
              })),
            }),
      })
      return json(res, 200, eventResource(account, calendarId, next))
    }
    if (method === "DELETE") {
      changeEvent(account, calendarId, { ...event, status: "cancelled" })
      res.writeHead(204)
      return res.end()
    }
    return fail(res, 405, "Method not allowed")
  }

  const admin = (path, _method, body, url, res) => {
    const account = accounts.get(body.email ?? url.searchParams.get("email") ?? "")
    switch (path) {
      case "/_admin/state":
        return json(res, 200, {
          accounts: [...accounts.values()].map((item) => ({
            email: item.email,
            messages: item.messages.size,
            sent: item.sent.length,
            historyId: item.historyId,
          })),
          refreshTokens: refreshTokens.size,
        })
      case "/_admin/deliver": {
        if (account === undefined) return fail(res, 404, "no such account")
        const message = deliver(account.email, body)
        return json(res, 200, { id: message.id, threadId: message.threadId })
      }
      case "/_admin/sent":
        if (account === undefined) return fail(res, 404, "no such account")
        return json(res, 200, {
          sent: account.sent.map((item) => ({
            ...item,
            parsed: {
              ...parseMime(item.raw),
              attachments: parseMime(item.raw).attachments.map((attachment) => ({
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.data.length,
              })),
            },
          })),
        })
      case "/_admin/expire-history":
        if (account === undefined) return fail(res, 404, "no such account")
        account.minHistoryId = account.historyId + 1
        account.minSyncSeq = account.changeSeq + 1
        return json(res, 200, {})
      case "/_admin/change-password":
        if (account === undefined) return fail(res, 404, "no such account")
        for (const [token, grant] of refreshTokens)
          if (grant.email === account.email) refreshTokens.delete(token)
        for (const [token, entry] of accessTokens)
          if (entry.email === account.email) accessTokens.delete(token)
        return json(res, 200, {})
      case "/_admin/expire-access":
        for (const entry of accessTokens.values()) entry.expiresAt = 0
        return json(res, 200, {})
      case "/_admin/calendar-event": {
        if (account === undefined) return fail(res, 404, "no such account")
        const calendarId = body.calendarId ?? account.email
        const event = insertEvent(account, calendarId, body, body.organizer ?? "carol@example.org")
        return json(res, 200, eventResource(account, calendarId, event))
      }
      default:
        return fail(res, 404, "no admin route")
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) fail(res, 500, String(error?.stack ?? error))
      else res.end()
    })
  })
  return {
    client,
    server,
    requests,
    accounts,
    deliver,
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address()
          resolve(`http://${host.includes(":") ? `[${host}]` : host}:${address.port}`)
        })
      })
    },
    close: () => new Promise((resolve) => server.close(() => resolve(undefined))),
    sent: (email) => accounts.get(email)?.sent ?? [],
    insertEvent: (email, body, organizer) => {
      const account = accounts.get(email)
      return eventResource(
        account,
        account.email,
        insertEvent(account, account.email, body, organizer),
      )
    },
    expireHistory(email) {
      const account = accounts.get(email)
      account.minHistoryId = account.historyId + 1
      account.minSyncSeq = account.changeSeq + 1
    },
    changePassword(email) {
      for (const [token, grant] of refreshTokens)
        if (grant.email === email) refreshTokens.delete(token)
      for (const [token, entry] of accessTokens)
        if (entry.email === email) accessTokens.delete(token)
    },
    expireAccessTokens() {
      for (const entry of accessTokens.values()) entry.expiresAt = 0
    },
  }
}
