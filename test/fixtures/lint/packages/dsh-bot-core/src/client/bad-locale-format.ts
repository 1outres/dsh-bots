export const stamp = (at: number) => new Date(at).toLocaleString() // rule: 47
export const day = (at: Date) => at.toLocaleDateString("ja") // rule: 47
export const clock = (at?: Date) => at?.toLocaleTimeString() // rule: 47
export const amount = (n: number) => n.toLocaleString() // rule: 47
export const dates = new Intl.DateTimeFormat(undefined, { dateStyle: "short" }) // rule: 47
export const relative = new Intl.RelativeTimeFormat("en") // rule: 47
export const plural = new Intl.PluralRules("en") // rule: 47
export const numbers = new Intl.NumberFormat("en") // rule: 47
export const zone = Intl.DateTimeFormat().resolvedOptions().timeZone // rule: 47
export const initial = (name: string) => name.toLocaleUpperCase()
export const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
