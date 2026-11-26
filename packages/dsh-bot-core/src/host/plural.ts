export interface Noun {
  readonly one: string
  readonly other: string
}

const RULES = new Intl.PluralRules("en")

export const counted = (count: number, noun: Noun): string =>
  `${count} ${RULES.select(count) === "one" ? noun.one : noun.other}`
