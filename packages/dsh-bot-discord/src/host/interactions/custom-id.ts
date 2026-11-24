import type { BotApprovalAction } from "@1outres/dsh-bot-core"
import { CUSTOM_ID_LIMIT } from "../discord"

/** What one component (or the modal it opens) of an interaction message does. */
export type InteractionAction =
  | { readonly kind: "choose"; readonly question: number; readonly option: number }
  | { readonly kind: "select"; readonly question: number; readonly chunk: number }
  | { readonly kind: "write"; readonly question: number }
  | { readonly kind: "skip"; readonly question: number }
  | { readonly kind: "page"; readonly page: number }
  | { readonly kind: "submit" }
  | { readonly kind: "hold" }
  | { readonly kind: "approval"; readonly action: BotApprovalAction }
  | { readonly kind: "approve-plan" }
  | { readonly kind: "decline-plan" }

const PREFIX = "dshb"
const APPROVAL_CODES: Readonly<Record<BotApprovalAction, string>> = {
  "allow-once": "o",
  reject: "r",
  always: "a",
}
const INTERACTION_ID = /^[A-Za-z0-9_-]{1,40}$/

function codeOf(action: InteractionAction): string {
  switch (action.kind) {
    case "choose":
      return `c.${action.question}.${action.option}`
    case "select":
      return `s.${action.question}.${action.chunk}`
    case "write":
      return `w.${action.question}`
    case "skip":
      return `k.${action.question}`
    case "page":
      return `p.${action.page}`
    case "submit":
      return "u"
    case "hold":
      return "h"
    case "approval":
      return `a.${APPROVAL_CODES[action.action]}`
    case "approve-plan":
      return "y"
    case "decline-plan":
      return "n"
  }
}

/**
 * A component's custom id: `dshb:<interaction id>:<action>`. It names
 * bot-core's interaction and the question and option by their positions, so
 * it stays within Discord's 100 characters whatever the labels are, and a
 * message posted before a reconnection still answers.
 */
export function encodeCustomId(interactionId: string, action: InteractionAction): string {
  if (!INTERACTION_ID.test(interactionId))
    throw new Error(`interaction id "${interactionId}" cannot be encoded`)
  const id = `${PREFIX}:${interactionId}:${codeOf(action)}`
  if (id.length > CUSTOM_ID_LIMIT)
    throw new Error(`custom id "${id}" is longer than ${CUSTOM_ID_LIMIT}`)
  return id
}

const index = (text: string | undefined): number | undefined =>
  text !== undefined && /^\d{1,4}$/.test(text) ? Number(text) : undefined

function actionOf(code: string): InteractionAction | undefined {
  const [kind, first, second] = code.split(".")
  const a = index(first)
  const b = index(second)
  switch (kind) {
    case "c":
      return a === undefined || b === undefined
        ? undefined
        : { kind: "choose", question: a, option: b }
    case "s":
      return a === undefined || b === undefined
        ? undefined
        : { kind: "select", question: a, chunk: b }
    case "w":
      return a === undefined ? undefined : { kind: "write", question: a }
    case "k":
      return a === undefined ? undefined : { kind: "skip", question: a }
    case "p":
      return a === undefined ? undefined : { kind: "page", page: a }
    case "u":
      return { kind: "submit" }
    case "h":
      return { kind: "hold" }
    case "a": {
      const action = (Object.keys(APPROVAL_CODES) as BotApprovalAction[]).find(
        (key) => APPROVAL_CODES[key] === first,
      )
      return action === undefined ? undefined : { kind: "approval", action }
    }
    case "y":
      return { kind: "approve-plan" }
    case "n":
      return { kind: "decline-plan" }
    default:
      return undefined
  }
}

/** The interaction and action a custom id names; undefined for any other id. */
export function decodeCustomId(
  customId: string,
): { readonly interactionId: string; readonly action: InteractionAction } | undefined {
  const [prefix, interactionId, code, ...rest] = customId.split(":")
  if (prefix !== PREFIX || interactionId === undefined || code === undefined || rest.length > 0) {
    return undefined
  }
  if (!INTERACTION_ID.test(interactionId)) return undefined
  const action = actionOf(code)
  return action === undefined ? undefined : { interactionId, action }
}
