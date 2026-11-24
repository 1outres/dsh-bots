import { describe, expect, it } from "vitest"
import {
  type BotChannelDescriptor,
  channelValuesOf,
  checkChannelDescriptor,
  missingChannelFields,
  parseChannelChange,
} from "../src/shared/channels"
import { FIELDS } from "./channels-support"

const descriptor: BotChannelDescriptor = { id: "chat", name: "Chat", fields: FIELDS }

describe("checkChannelDescriptor", () => {
  it("accepts a valid descriptor", () => {
    expect(() => checkChannelDescriptor(descriptor)).not.toThrow()
  })

  it.each([
    [{ ...descriptor, id: "Chat" }, "lowercase"],
    [{ ...descriptor, name: " " }, "no name"],
    [{ ...descriptor, fields: [...FIELDS, FIELDS[0]] }, "declared twice"],
    [{ ...descriptor, fields: [{ ...FIELDS[0], key: "bad-key" }] }, "camelCase"],
    [{ ...descriptor, fields: [{ ...FIELDS[0], label: { en: "" } }] }, "no English"],
    [{ ...descriptor, fields: [{ ...FIELDS[0], maxLength: 0 }] }, "maxLength"],
    [{ ...descriptor, fields: [{ ...FIELDS[1], pattern: "(" }] }, "regular expression"],
    [{ ...descriptor, fields: [{ ...FIELDS[2], minItems: 4 }] }, "minItems"],
    [{ ...descriptor, guide: "http://example.com" }, "https URL"],
    [{ ...descriptor, fields: [{ ...FIELDS[1], choices: [] }] }, "list nothing"],
    [
      { ...descriptor, fields: [{ ...FIELDS[1], choices: [{ value: "a", label: { en: "A" } }] }] },
      'must list ""',
    ],
    [
      {
        ...descriptor,
        fields: [{ ...FIELDS[1], required: true, choices: [{ value: "", label: { en: "None" } }] }],
      },
      'must not list ""',
    ],
    [
      {
        ...descriptor,
        fields: [
          {
            ...FIELDS[1],
            choices: [
              { value: "", label: { en: "None" } },
              { value: "", label: { en: "Again" } },
            ],
          },
        ],
      },
      "listed twice",
    ],
    [
      {
        ...descriptor,
        fields: [
          {
            ...FIELDS[1],
            choices: [
              { value: "", label: { en: "None" } },
              { value: " a", label: { en: "A" } },
            ],
          },
        ],
      },
      "not a value of the field",
    ],
  ] as [BotChannelDescriptor, string][])("refuses %#", (channel, message) => {
    expect(() => checkChannelDescriptor(channel)).toThrow(message)
  })
})

describe("enumerated text fields", () => {
  const language = {
    kind: "text",
    key: "language",
    label: { en: "Language" },
    required: false,
    maxLength: 2,
    choices: [
      { value: "", label: { en: "Default" } },
      { value: "ja", label: { en: "Japanese" } },
    ],
  } as const

  it("accepts a channel with a guide and choices, and takes only listed values", () => {
    expect(() =>
      checkChannelDescriptor({ ...descriptor, guide: "https://example.com", fields: [language] }),
    ).not.toThrow()
    const change = (value: string) => ({ enabled: true, values: { language: value }, secrets: {} })
    expect(parseChannelChange([language], change(" ja ")).values).toEqual({ language: "ja" })
    expect(parseChannelChange([language], change("")).values).toEqual({ language: "" })
    expect(() => parseChannelChange([language], change("en"))).toThrow("one of its choices")
  })
})

describe("parseChannelChange", () => {
  const valid = {
    enabled: true,
    values: { server: " abc ", users: [" 1 ", "", "1", "22"] },
    secrets: { token: { op: "set", value: " t " } },
  }

  it("trims, drops empty and repeated items, and defaults secrets to keep", () => {
    expect(parseChannelChange(FIELDS, valid)).toEqual({
      enabled: true,
      values: { server: "abc", users: ["1", "22"] },
      secrets: { token: { op: "set", value: "t" } },
    })
    expect(parseChannelChange(FIELDS, { ...valid, secrets: {} }).secrets).toEqual({
      token: { op: "keep" },
    })
  })

  it.each([
    [{ ...valid, enabled: "yes" }, "enabled"],
    [{ ...valid, values: { users: ["1"] } }, "server must be text"],
    [{ ...valid, values: { ...valid.values, server: "ABC" } }, "invalid format"],
    [{ ...valid, values: { ...valid.values, users: ["x"] } }, "not a valid item"],
    [{ ...valid, values: { ...valid.values, users: ["1", "2", "3", "4"] } }, "more than 3"],
    [{ ...valid, values: { ...valid.values, token: "t" } }, "not a value"],
    [{ ...valid, values: { ...valid.values, other: "x" } }, "not a value"],
    [{ ...valid, secrets: { server: { op: "clear" } } }, "not a secret"],
    [{ ...valid, secrets: { token: { op: "set", value: "  " } } }, "clear it instead"],
    [{ ...valid, secrets: { token: { op: "set", value: "x".repeat(65) } } }, "longer than 64"],
    [{ ...valid, secrets: { token: { op: "show" } } }, "unknown change"],
  ])("refuses %#", (input, message) => {
    expect(() => parseChannelChange(FIELDS, input)).toThrow(message)
  })
})

describe("channel values", () => {
  it("reads stored values over empty ones and drops undeclared ones", () => {
    expect(channelValuesOf(FIELDS, { server: "a", gone: "x", users: "not a list" })).toEqual({
      server: "a",
      users: [],
    })
  })

  it("lists required fields without a value", () => {
    expect(missingChannelFields(FIELDS, { server: "", users: [] }, () => false)).toEqual([
      "token",
      "users",
    ])
    expect(missingChannelFields(FIELDS, { server: "", users: ["1"] }, () => true)).toEqual([])
  })
})
