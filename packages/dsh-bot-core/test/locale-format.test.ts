import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterAll, describe, expect, it } from "vitest"
import { ActionCard } from "../src/client/approvals/ActionCard"
import type { DecisionOutcome } from "../src/client/approvals/actions-model"
import { en, ja } from "../src/client/i18n"
import { FORMAT_LOCALE_KEY, localeFormat, relativeParts } from "../src/client/locale-format"
import type { ConnectorActionView } from "../src/shared/connectors"
import { translateWith } from "./support/client"

const AT = Date.UTC(2026, 10, 23, 12, 28, 18)
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const spaced = (text: string) => text.replace(/\s/g, " ")

const zone = process.env.TZ
process.env.TZ = "Asia/Tokyo"

afterAll(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
})

const english = localeFormat(translateWith(en))
const japanese = localeFormat(translateWith(ja))

describe("localeFormat", () => {
  it("takes its language from the dictionary the messages come from", () => {
    expect(english.locale).toBe("en")
    expect(japanese.locale).toBe("ja")
  })

  it("writes instants in the messages' language and the reader's time zone", () => {
    expect(spaced(english.instant(AT, "dateTime"))).toBe("Nov 23, 2026, 9:28 PM")
    expect(japanese.instant(AT, "dateTime")).toBe("2026/11/23 21:28")
    expect(spaced(english.instant(AT, "time"))).toBe("9:28:18 PM")
    expect(japanese.instant(AT, "time")).toBe("21:28:18")
  })

  it("picks the largest whole unit, rounding a moment left up", () => {
    expect(relativeParts(10 * MINUTE, 0, "largestUnit")).toEqual({ value: 10, unit: "minute" })
    expect(relativeParts(1, 0, "largestUnit")).toEqual({ value: 1, unit: "minute" })
    expect(relativeParts(5 * HOUR, 0, "largestUnit")).toEqual({ value: 5, unit: "hour" })
    expect(relativeParts(72 * HOUR, 0, "largestUnit")).toEqual({ value: 3, unit: "day" })
    expect(relativeParts(0, 3 * MINUTE, "largestUnit")).toEqual({ value: -3, unit: "minute" })
    expect(relativeParts(150_500, 0, "seconds")).toEqual({ value: 151, unit: "second" })
  })

  it("words relative times in the messages' language", () => {
    expect(english.relative(5 * MINUTE, 0, "largestUnit")).toBe("in 5 minutes")
    expect(english.relative(MINUTE, 0, "largestUnit")).toBe("in 1 minute")
    expect(japanese.relative(5 * MINUTE, 0, "largestUnit")).toBe("5 分後")
    expect(english.relative(1000, 0, "seconds")).toBe("in 1 second")
    expect(japanese.relative(30_000, 0, "seconds")).toBe("30 秒後")
  })

  it("words counts by the plural rules of the messages' language", () => {
    expect(english.count("connections.count", 1)).toBe("1 account")
    expect(english.count("connections.count", 2)).toBe("2 accounts")
    expect(english.count("files.search.count", 0)).toBe("0 files")
    expect(english.count("files.search.count", 1200)).toBe("1,200 files")
    expect(english.count("bot.waiting", 1)).toBe("1 connector action waits for your decision")
    expect(english.count("sessions.expand", 1)).toBe("Show 1 more session")
    expect(english.count("archive.confirm.jobs", 1, { names: "build" })).toBe(
      "1 background job: build",
    )
    expect(japanese.count("connections.count", 1)).toBe("1 個のアカウント")
    expect(japanese.count("sessions.expand", 3)).toBe("さらに3件のセッションを表示")
  })
})

describe("dictionaries", () => {
  const dictionaries = { en, ja }
  const pluralKeys = Object.keys(en)
    .filter((key) => key.endsWith(".other"))
    .map((key) => key.slice(0, -".other".length))
    .filter((base) => `${base}.one` in en)

  it.each(Object.entries(dictionaries))(
    "%s words every plural message for each category its language uses",
    (_, dictionary) => {
      const categories = new Intl.PluralRules(dictionary[FORMAT_LOCALE_KEY]).resolvedOptions()
        .pluralCategories
      const missing = pluralKeys.flatMap((key) =>
        categories
          .filter((category) => dictionary[`${key}.${category}`] === undefined)
          .map((category) => `${key}.${category}`),
      )
      expect(missing).toEqual([])
    },
  )

  it.each(Object.entries(dictionaries))(
    "%s puts {count} in every plural message and no plural message without it",
    (_, dictionary) => {
      const words = Object.entries(dictionary).filter(([key]) =>
        pluralKeys.some((base) => key.startsWith(`${base}.`)),
      )
      expect(words.filter(([, text]) => !text.includes("{count}"))).toEqual([])
    },
  )
})

describe("approval card times", () => {
  const action: ConnectorActionView = {
    id: "a",
    botId: "b1",
    connector: { id: "mail", name: "Mail" },
    tool: "send",
    toolName: "mail_send",
    args: {},
    preview: { title: "Send this email?", fields: [] },
    createdAt: AT,
    expiresAt: AT + 5 * MINUTE,
    status: { state: "pending" },
  }
  const render = (dictionary: Readonly<Record<string, string>>) =>
    spaced(
      renderToStaticMarkup(
        createElement(ActionCard, {
          t: translateWith(dictionary),
          action,
          now: AT,
          decide: async (): Promise<DecisionOutcome> => ({ kind: "unreachable", message: "x" }),
        }),
      ),
    )

  it("shows when it expires as a relative time, the instant as its tooltip, in English", () => {
    const html = render(en)
    expect(html).toContain('title="Nov 23, 2026, 9:33 PM" data-dshb-action-expiry="">in 5 minutes<')
    expect(html).toContain('title="Nov 23, 2026, 9:28 PM">Mail · mail_send · ')
  })

  it("shows when it expires as a relative time, the instant as its tooltip, in Japanese", () => {
    const html = render(ja)
    expect(html).toContain('title="2026/11/23 21:33" data-dshb-action-expiry="">5 分後<')
  })
})
