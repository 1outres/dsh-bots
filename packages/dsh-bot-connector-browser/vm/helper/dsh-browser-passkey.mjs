#!/usr/bin/env node
// Offers one passkey to the tab the Host marked (browser connector, browser_use_passkey): a
// virtual authenticator on that tab's DevTools session, alive while this process is, until the
// site used it once, the time is up, the tab left the origin or closed, or the Host ended it.
// stdin: {"devtools","mark"}, then, after this answers {"located"}, {"passkey":{"origin","rpId",
// "credentialId","userHandle"?,"signCount","seconds","length"}} followed by the PKCS#8 key's bytes.
// stdout: JSON lines with closed codes only. The key is never a JS string here and is wiped.
import { base64Bytes } from "./bytes.mjs"
import { connectBrowser, parseEndpoint } from "./cdp.mjs"
import { openChannel } from "./channel.mjs"
import {
  attachTargets,
  checkMark,
  findMarked,
  frameOrigin,
  PageError,
  unmark,
  webOrigin,
} from "./page.mjs"

const ATTRIBUTE = "data-dsh-passkey"
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const RP_ID = /^[a-z0-9.-]{1,253}$/
const MAX_SECONDS = 120

function checkOrder(order, origin) {
  const passkey = order?.passkey
  if (
    typeof passkey !== "object" ||
    passkey === null ||
    passkey.origin !== origin ||
    typeof passkey.rpId !== "string" ||
    !RP_ID.test(passkey.rpId) ||
    typeof passkey.credentialId !== "string" ||
    !BASE64.test(passkey.credentialId) ||
    (passkey.userHandle !== undefined &&
      (typeof passkey.userHandle !== "string" || !BASE64.test(passkey.userHandle))) ||
    !Number.isSafeInteger(passkey.signCount) ||
    passkey.signCount < 0 ||
    !Number.isSafeInteger(passkey.seconds) ||
    passkey.seconds < 1 ||
    passkey.seconds > MAX_SECONDS
  ) {
    throw new PageError("protocol")
  }
  return passkey
}

async function main() {
  const channel = openChannel()
  const request = await channel.line()
  if (request === undefined) throw new PageError("protocol")
  const mark = checkMark(request.mark)
  let cdp
  try {
    cdp = await connectBrowser(parseEndpoint(request.devtools))
  } catch {
    throw new PageError("devtools")
  }
  let authenticatorId
  let session
  try {
    const tab = await findMarked(cdp, await attachTargets(cdp, ["page"]), {
      attribute: ATTRIBUTE,
      mark,
      mainFrameOnly: true,
    })
    await unmark(cdp, tab, ATTRIBUTE)
    session = tab.sessionId
    const origin = webOrigin(tab.origin)
    channel.reply({ located: { origin } })

    const order = await channel.line()
    if (order === undefined) {
      channel.reply({ cancelled: true })
      return
    }
    const passkey = checkOrder(order, origin)
    const key = await channel.bytes(order.passkey.length)
    try {
      if ((await frameOrigin(cdp, session, tab.frameId)) !== origin)
        throw new PageError("origin-changed")
      await cdp.call("Page.enable", {}, session)
      await cdp.call("WebAuthn.enable", { enableUI: false }, session)
      authenticatorId = (
        await cdp.call(
          "WebAuthn.addVirtualAuthenticator",
          {
            options: {
              protocol: "ctap2",
              transport: "internal",
              hasResidentKey: true,
              hasUserVerification: true,
              isUserVerified: true,
              automaticPresenceSimulation: true,
            },
          },
          session,
        )
      ).authenticatorId
      const encoded = base64Bytes(key)
      try {
        const before = JSON.stringify({
          authenticatorId,
          credential: {
            credentialId: passkey.credentialId,
            isResidentCredential: true,
            rpId: passkey.rpId,
            ...(passkey.userHandle === undefined ? {} : { userHandle: passkey.userHandle }),
            signCount: passkey.signCount,
            privateKey: "",
          },
        })
        const cut = before.lastIndexOf('""')
        await cdp
          .callWithSecret(
            "WebAuthn.addCredential",
            before.slice(0, cut + 1),
            encoded,
            before.slice(cut + 1),
            session,
          )
          .catch(() => {
            throw new PageError("rejected")
          })
      } finally {
        encoded.fill(0)
      }
    } finally {
      key.fill(0)
    }
    channel.reply({ ready: { origin } })
    const reason = await outcome(cdp, channel, {
      session,
      authenticatorId,
      origin,
      frameId: tab.frameId,
      seconds: passkey.seconds,
    })
    await removeAuthenticator(cdp, authenticatorId, session)
    authenticatorId = undefined
    channel.reply({ ended: reason })
  } finally {
    if (authenticatorId !== undefined) await removeAuthenticator(cdp, authenticatorId, session)
    cdp.close()
  }
}

const removeAuthenticator = (cdp, authenticatorId, session) =>
  cdp.call("WebAuthn.removeVirtualAuthenticator", { authenticatorId }, session).catch(() => {})

/** Why the authenticator goes away: used once, time up, the tab left the origin or closed, or the Host ended it. */
function outcome(cdp, channel, { session, authenticatorId, origin, frameId, seconds }) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("expired"), seconds * 1000)
    const finish = (reason) => {
      clearTimeout(timer)
      resolve(reason)
    }
    cdp.on((message) => {
      if (message.method === "Target.detachedFromTarget" && message.params?.sessionId === session)
        finish("closed")
      if (message.sessionId !== session) return
      if (
        message.method === "WebAuthn.credentialAsserted" &&
        message.params?.authenticatorId === authenticatorId
      ) {
        finish("used")
      }
      if (
        message.method === "Page.frameNavigated" &&
        message.params?.frame?.id === frameId &&
        message.params.frame.securityOrigin !== origin
      ) {
        finish("navigated")
      }
    })
    cdp.closed.then(() => finish("closed"))
    channel.ended.then(() => finish("released"))
    process.once("SIGTERM", () => finish("released"))
  })
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stdout.write(
      `${JSON.stringify({ error: error instanceof PageError ? error.code : "failed" })}\n`,
    )
    process.exit(1)
  },
)
