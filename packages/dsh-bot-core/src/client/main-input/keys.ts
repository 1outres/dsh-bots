export interface KeyFacts {
  readonly key: string
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly isComposing: boolean
  readonly keyCode: number
}

export type KeyIntent = "submit" | "type"

const IME_KEY_CODE = 229

export function keyIntent(facts: KeyFacts): KeyIntent {
  if (facts.key !== "Enter") return "type"
  if (facts.isComposing || facts.keyCode === IME_KEY_CODE) return "type"
  if (facts.shiftKey || facts.altKey || facts.ctrlKey || facts.metaKey) return "type"
  return "submit"
}
