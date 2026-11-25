// Finding what the Host marked through Playwright MCP: one element (or a tab's document) carrying
// a one-time attribute, searched in an isolated world of every frame of every tab (out-of-process
// frames included), with the frame's origin as the browser reports it, not as the page says.

const WORLD = "dsh-browser-vault"
const MARK = /^[0-9a-f]{32}$/
const ORIGIN = /^https?:\/\/[^/\s]+$/

export class PageError extends Error {
  constructor(code) {
    super(code)
    this.name = "PageError"
    this.code = code
  }
}

export function checkMark(value) {
  if (typeof value !== "string" || !MARK.test(value)) throw new PageError("protocol")
  return value
}

const findExpression = (attribute, mark) => `(() => {
  const found = [];
  const visit = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.getAttribute("${attribute}") === "${mark}") found.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(document);
  return found.length === 1 ? found[0] : found.length;
})()`

function framesOf(tree, out = []) {
  out.push(tree.frame)
  for (const child of tree.childFrames ?? []) framesOf(child, out)
  return out
}

/** Attach to every target of the types (flat sessions). */
export async function attachTargets(cdp, types) {
  const { targetInfos } = await cdp.call("Target.getTargets")
  const sessions = []
  for (const target of targetInfos) {
    if (!types.includes(target.type)) continue
    try {
      const { sessionId } = await cdp.call("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      })
      sessions.push({ sessionId, targetId: target.targetId, type: target.type })
    } catch {}
  }
  return sessions
}

/** The frame's origin now, as the browser reports it; undefined when the frame is gone. */
export async function frameOrigin(cdp, sessionId, frameId) {
  const { frameTree } = await cdp.call("Page.getFrameTree", {}, sessionId)
  return framesOf(frameTree).find((frame) => frame.id === frameId)?.securityOrigin
}

/** A web origin (http or https with a host); an opaque or other one is refused. */
export function webOrigin(origin) {
  if (typeof origin !== "string" || !ORIGIN.test(origin)) throw new PageError("opaque-origin")
  return origin
}

/**
 * The one marked node: its session, frame, the frame's origin and a handle in the isolated
 * world. `mainFrameOnly` searches the tabs' top documents only.
 */
export async function findMarked(cdp, sessions, { attribute, mark, mainFrameOnly }) {
  const seen = new Set()
  const matches = []
  let count = 0
  for (const session of sessions) {
    let tree
    try {
      tree = (await cdp.call("Page.getFrameTree", {}, session.sessionId)).frameTree
    } catch {
      continue
    }
    const frames = mainFrameOnly ? [tree.frame] : framesOf(tree)
    for (const frame of frames) {
      if (seen.has(frame.id)) continue
      let contextId
      try {
        contextId = (
          await cdp.call(
            "Page.createIsolatedWorld",
            { frameId: frame.id, worldName: WORLD, grantUniveralAccess: false },
            session.sessionId,
          )
        ).executionContextId
      } catch {
        continue
      }
      seen.add(frame.id)
      const { result } = await cdp.call(
        "Runtime.evaluate",
        { expression: findExpression(attribute, mark), contextId, returnByValue: false },
        session.sessionId,
      )
      if (result.type === "object" && typeof result.objectId === "string") {
        count += 1
        matches.push({
          sessionId: session.sessionId,
          frameId: frame.id,
          origin: frame.securityOrigin,
          objectId: result.objectId,
        })
      } else if (typeof result.value === "number") {
        count += result.value
      }
    }
  }
  if (count === 0) throw new PageError("not-found")
  if (count > 1 || matches.length !== 1) throw new PageError("ambiguous")
  return matches[0]
}

/** Run a function on the node in its isolated world and return its JSON value. */
export async function onNode(cdp, node, functionDeclaration) {
  const { result, exceptionDetails } = await cdp.call(
    "Runtime.callFunctionOn",
    { objectId: node.objectId, functionDeclaration, returnByValue: true },
    node.sessionId,
  )
  if (exceptionDetails !== undefined) throw new PageError("not-found")
  return result.value
}

export const unmark = (cdp, node, attribute) =>
  onNode(cdp, node, `function () { this.removeAttribute("${attribute}"); return true }`)
