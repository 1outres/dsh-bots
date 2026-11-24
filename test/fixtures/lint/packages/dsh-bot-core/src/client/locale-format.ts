export const instant = (locale: string) => new Intl.DateTimeFormat(locale, { timeStyle: "short" })
export const plural = (locale: string) => new Intl.PluralRules(locale)
