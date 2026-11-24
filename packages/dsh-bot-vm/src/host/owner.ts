/**
 * The owner tag (`user.dsh-bot.owner`) of the instances one installation
 * creates. Stored once in `<stateDir>/owner`: a random id for a new
 * installation; an installation of an earlier version (bot state under
 * `<stateDir>/bots` but no owner file) keeps the tag its instances carry,
 * the hash of the state directory's real path.
 */

export const OWNER_FILE = "owner"
const OWNER = /^[0-9a-f]{16,64}$/

export interface OwnerFacts {
  /** The owner file's content, or undefined when it does not exist. */
  readonly stored: string | undefined
  /** Whether `<stateDir>/bots` exists (bots provisioned by an earlier version). */
  readonly hasEarlierState: boolean
  /** The earlier versions' tag: the hash of the state directory's real path. */
  readonly earlierOwner: () => string
  readonly random: () => string
}

export type OwnerDecision =
  | { readonly kind: "stored"; readonly owner: string }
  | { readonly kind: "create"; readonly owner: string; readonly why: "new" | "earlier" }

export function decideOwner(facts: OwnerFacts): OwnerDecision {
  if (facts.stored !== undefined) {
    const owner = facts.stored.trim()
    if (!OWNER.test(owner)) {
      throw new Error(`the owner file holds "${owner}", not 16 to 64 lowercase hex digits`)
    }
    return { kind: "stored", owner }
  }
  return facts.hasEarlierState
    ? { kind: "create", owner: facts.earlierOwner(), why: "earlier" }
    : { kind: "create", owner: facts.random(), why: "new" }
}
