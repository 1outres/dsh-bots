import type { ConnectorDecision } from "@1outres/dsh-bot-core"
import { CUSTOM_ID_LIMIT } from "../discord"

const PREFIX = "dshc"
const CODES: Readonly<Record<ConnectorDecision, string>> = { approve: "a", reject: "r" }
const ACTION_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Whether a custom id is one of a connector action card's buttons. */
export function isActionCustomId(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`)
}

/**
 * A decision button's custom id: `dshc:<action id>:<a|r>`. It names the
 * ledger's action only, so a card posted before a restart still decides.
 */
export function encodeActionCustomId(actionId: string, decision: ConnectorDecision): string {
  if (!ACTION_ID.test(actionId)) throw new Error(`action id "${actionId}" cannot be encoded`)
  const id = `${PREFIX}:${actionId}:${CODES[decision]}`
  if (id.length > CUSTOM_ID_LIMIT)
    throw new Error(`custom id "${id}" is longer than ${CUSTOM_ID_LIMIT}`)
  return id
}

/** The action and decision a custom id names; undefined for any other id. */
export function decodeActionCustomId(
  customId: string,
): { readonly actionId: string; readonly decision: ConnectorDecision } | undefined {
  const [prefix, actionId, code, ...rest] = customId.split(":")
  if (prefix !== PREFIX || actionId === undefined || rest.length > 0) return undefined
  if (!ACTION_ID.test(actionId)) return undefined
  const decision = (Object.keys(CODES) as ConnectorDecision[]).find((key) => CODES[key] === code)
  return decision === undefined ? undefined : { actionId, decision }
}
