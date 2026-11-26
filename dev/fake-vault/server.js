import { createHash, createPublicKey, randomBytes, verify } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { totp } from "./otp.js"

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const page = (title, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })

function usersOf(items) {
  return items.vaults.flatMap((vault) => vault.items.filter((item) => item.username !== undefined))
}

function checkAssertion(assertion, passkeys, challenge, origin) {
  const key = passkeys.find((each) => each.credentialId === assertion.id)
  if (key === undefined) return "unknown credential"
  const clientData = Buffer.from(assertion.clientDataJSON, "base64url")
  const client = JSON.parse(clientData.toString("utf8"))
  if (client.type !== "webauthn.get") return "not an assertion"
  if (client.challenge !== challenge) return "wrong challenge"
  if (client.origin !== origin) return `wrong origin ${client.origin}`
  const authData = Buffer.from(assertion.authenticatorData, "base64url")
  const rpIdHash = createHash("sha256").update(key.rpId).digest()
  if (!authData.subarray(0, 32).equals(rpIdHash)) return "wrong relying party"
  if ((authData[32] & 1) === 0) return "user not present"
  const signed = Buffer.concat([authData, createHash("sha256").update(clientData).digest()])
  const publicKey = createPublicKey({
    key: Buffer.from(key.publicKey, "base64"),
    format: "der",
    type: "spki",
  })
  const ok = verify("sha256", signed, publicKey, Buffer.from(assertion.signature, "base64url"))
  return ok ? undefined : "bad signature"
}

const PASSKEY_SCRIPT = (options) => `
<button id="go">Sign in with a passkey</button><p id="result"></p>
<script>
const options = ${JSON.stringify(options)}
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
const enc = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "")
document.getElementById("go").onclick = async () => {
  const result = document.getElementById("result")
  try {
    const credential = await navigator.credentials.get({ publicKey: {
      challenge: b64(options.challenge), rpId: options.rpId, userVerification: "preferred",
      allowCredentials: options.ids.map((id) => ({ type: "public-key", id: b64(id) })),
    } })
    const response = await fetch("/passkey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      id: credential.id,
      clientDataJSON: enc(credential.response.clientDataJSON),
      authenticatorData: enc(credential.response.authenticatorData),
      signature: enc(credential.response.signature),
    }) })
    result.textContent = await response.text()
  } catch (error) { result.textContent = "Failed: " + error.message }
}
</script>`

export function createTestSite({ items, passkeys = () => [] }) {
  const sessions = new Map()
  const challenges = new Set()
  const userOf = (request) => {
    const cookie = /(?:^|; )sid=([a-f0-9]+)/.exec(request.headers.cookie ?? "")
    return cookie === null ? undefined : sessions.get(cookie[1])
  }
  const signIn = (response, user, step) => {
    const sid = randomBytes(16).toString("hex")
    sessions.set(sid, { user, step })
    response.setHeader("set-cookie", `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`)
  }
  const send = (response, status, html) => {
    response.writeHead(status, { "content-type": "text/html; charset=utf-8" })
    response.end(html)
  }
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
    const origin = `http://${request.headers.host}`
    try {
      if (url.pathname === "/" || (url.pathname === "/login" && request.method === "GET")) {
        return send(
          response,
          200,
          page(
            "Sign in",
            `<form method="post" action="/login">
<label>Username <input name="username" autocomplete="username"></label>
<label>Password <input name="password" type="password" autocomplete="current-password"></label>
<button type="submit">Sign in</button></form><p><a href="/passkey">Use a passkey</a></p>`,
          ),
        )
      }
      if (url.pathname === "/login") {
        const form = new URLSearchParams(await readBody(request))
        const user = usersOf(items).find((item) => item.username === form.get("username"))
        if (user === undefined || user.password !== form.get("password")) {
          return send(
            response,
            401,
            page("Sign in failed", '<p>Wrong username or password.</p><a href="/login">Again</a>'),
          )
        }
        if (user.totp !== undefined) {
          signIn(response, user, "otp")
          return send(
            response,
            200,
            page(
              "One-time code",
              `<form method="post" action="/otp">
<label>Code <input name="code" autocomplete="one-time-code" inputmode="numeric"></label>
<button type="submit">Verify</button></form>`,
            ),
          )
        }
        signIn(response, user, "done")
        return send(
          response,
          200,
          page("Signed in", `<p>Signed in as ${escapeHtml(user.username)}.</p>`),
        )
      }
      if (url.pathname === "/otp" && request.method === "POST") {
        const session = userOf(request)
        const form = new URLSearchParams(await readBody(request))
        if (session?.step !== "otp" || form.get("code") !== totp(session.user.totp)) {
          return send(response, 401, page("Code refused", '<a href="/login">Again</a>'))
        }
        session.step = "done"
        return send(
          response,
          200,
          page(
            "Signed in",
            `<p>Signed in as ${escapeHtml(session.user.username)} with a one-time code.</p>`,
          ),
        )
      }
      if (url.pathname === "/passkey" && request.method === "GET") {
        const challenge = randomBytes(32).toString("base64url")
        challenges.add(challenge)
        const keys = passkeys()
        return send(
          response,
          200,
          page(
            "Passkey",
            PASSKEY_SCRIPT({
              challenge,
              rpId: url.hostname,
              ids: keys.filter((key) => key.rpId === url.hostname).map((key) => key.credentialId),
            }),
          ),
        )
      }
      if (url.pathname === "/passkey") {
        const assertion = JSON.parse(await readBody(request))
        const client = JSON.parse(
          Buffer.from(assertion.clientDataJSON, "base64url").toString("utf8"),
        )
        if (!challenges.delete(client.challenge)) return send(response, 401, "Unknown challenge")
        const problem = checkAssertion(assertion, passkeys(), client.challenge, origin)
        return send(
          response,
          problem === undefined ? 200 : 401,
          problem === undefined ? "Signed in with a passkey." : `Refused: ${problem}`,
        )
      }
      if (url.pathname === "/account") {
        const session = userOf(request)
        if (session?.step !== "done")
          return send(response, 401, page("Not signed in", '<a href="/login">Sign in</a>'))
        return send(
          response,
          200,
          page(
            "Account",
            `<p>User: ${escapeHtml(session.user.username)}</p><p>Your password is <code id="password">${escapeHtml(session.user.password)}</code></p>`,
          ),
        )
      }
      send(response, 404, page("Not found", ""))
    } catch (error) {
      send(response, 500, page("Error", `<pre>${escapeHtml(error.message)}</pre>`))
    }
  })
  return {
    server,
    listen: (port, host) =>
      new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = server.address()
          resolve(`http://${host}:${address.port}`)
        })
      }),
  }
}

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))
