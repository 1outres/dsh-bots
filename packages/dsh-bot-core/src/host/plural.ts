/** An English noun phrase in its singular and plural forms. */
export interface Noun {
  readonly one: string
  readonly other: string
}

const RULES = new Intl.PluralRules("en")

/** "1 message", "2 messages". */
export const counted = (count: number, noun: Noun): string =>
  `${count} ${RULES.select(count) === "one" ? noun.one : noun.other}`
