export const OWNER_FILE = "owner"
const OWNER = /^[0-9a-f]{16,64}$/

export interface OwnerFacts {
  readonly stored: string | undefined
  readonly hasEarlierState: boolean
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
