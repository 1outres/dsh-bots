#!/usr/bin/env node
import { isUtf8, jsonStringBytes } from "./bytes.mjs"
import { connectBrowser, parseEndpoint } from "./cdp.mjs"
import { openChannel } from "./channel.mjs"
import {
  attachTargets,
  checkMark,
  findMarked,
  frameOrigin,
  onNode,
  PageError,
  unmark,
  webOrigin,
} from "./page.mjs"

const ATTRIBUTE = "data-dsh-fill"
const FIELDS = ["username", "password", "otp"]
const TEXT_TYPES = ["text", "email", "tel", "url", "search", "password", "number"]

const DESCRIBE = `function () {
  const tag = this.localName;
  const tokens = (this.getAttribute("autocomplete") || "").toLowerCase().split(/\\s+/);
  return {
    tag,
    type: tag === "input" ? this.type : null,
    editable: this.isContentEditable === true,
    disabled: this.disabled === true || this.readOnly === true,
    password: (tag === "input" && this.type === "password") || tokens.includes("current-password") || tokens.includes("new-password"),
  };
}`

const CLEAR = `function () {
  if (this.localName === "input" || this.localName === "textarea") {
    this.focus();
    this.select();
  } else {
    this.focus();
    const selection = this.ownerDocument.getSelection();
    selection.selectAllChildren(this);
  }
  const root = this.getRootNode();
  return root.activeElement === this || this.contains(root.activeElement);
}`

const FOCUSED = `function () {
  const root = this.getRootNode();
  return this.isConnected && (root.activeElement === this || this.contains(root.activeElement));
}`

function elementKind(description, field) {
  const { tag, type, editable, disabled, password } = description
  const kind =
    tag === "input" && TEXT_TYPES.includes(type)
      ? `input:${type}`
      : tag === "textarea"
        ? "textarea"
        : editable
          ? "contenteditable"
          : undefined
  if (kind === undefined || disabled) throw new PageError("not-editable")
  if (field === "password" && !password) throw new PageError("not-password-field")
  return kind
}

async function main() {
  const channel = openChannel()
  const request = await channel.line()
  if (request === undefined || !FIELDS.includes(request.field)) throw new PageError("protocol")
  const mark = checkMark(request.mark)
  let cdp
  try {
    cdp = await connectBrowser(parseEndpoint(request.devtools))
  } catch {
    throw new PageError("devtools")
  }
  let node
  try {
    const sessions = await attachTargets(cdp, ["page", "iframe"])
    node = await findMarked(cdp, sessions, { attribute: ATTRIBUTE, mark, mainFrameOnly: false })
    const element = elementKind(await onNode(cdp, node, DESCRIBE), request.field)
    const origin = webOrigin(node.origin)
    channel.reply({ located: { origin, element } })

    const order = await channel.line()
    if (order === undefined) {
      channel.reply({ cancelled: true })
      return
    }
    const fill = order.fill
    if (
      typeof fill !== "object" ||
      fill === null ||
      fill.origin !== origin ||
      typeof fill.submit !== "boolean"
    ) {
      throw new PageError("protocol")
    }
    const value = await channel.bytes(fill.length)
    try {
      if (!isUtf8(value)) throw new PageError("not-text")
      if ((await frameOrigin(cdp, node.sessionId, node.frameId)) !== origin)
        throw new PageError("origin-changed")
      await cdp.call("DOM.enable", {}, node.sessionId)
      await cdp.call("DOM.focus", { objectId: node.objectId }, node.sessionId)
      if ((await onNode(cdp, node, CLEAR)) !== true) throw new PageError("focus-lost")
      if ((await frameOrigin(cdp, node.sessionId, node.frameId)) !== origin)
        throw new PageError("origin-changed")
      const text = jsonStringBytes(value)
      try {
        await cdp.callWithSecret("Input.insertText", '{"text":"', text, '"}', node.sessionId)
      } finally {
        text.fill(0)
      }
    } finally {
      value.fill(0)
    }
    const focused = (await onNode(cdp, node, FOCUSED)) === true
    await unmark(cdp, node, ATTRIBUTE)
    const { sessionId } = node
    node = undefined
    if (fill.submit) {
      if (!focused) throw new PageError("focus-lost")
      await pressEnter(cdp, sessionId)
    }
    channel.reply({ filled: { submitted: fill.submit } })
  } finally {
    if (node !== undefined) await unmark(cdp, node, ATTRIBUTE).catch(() => {})
    cdp.close()
  }
}

async function pressEnter(cdp, sessionId) {
  const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await cdp.call(
    "Input.dispatchKeyEvent",
    { type: "keyDown", ...key, text: "\r", unmodifiedText: "\r" },
    sessionId,
  )
  await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", ...key }, sessionId)
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
