import type { SenderInquiryView } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { decodeInquiryCustomId, encodeInquiryCustomId } from "../src/host/senders/custom-id"
import { renderInquiryCard } from "../src/host/senders/render"

const inquiry = (overrides: Partial<SenderInquiryView> = {}): SenderInquiryView => ({
  id: "snd-1",
  connectionId: "conn-1",
  account: "alice@example.com",
  connector: { id: "gmail", name: "Gmail" },
  address: "cy@gmail.com",
  domain: "gmail.com",
  choices: ["allow-address", "deny-address", "deny-domain"],
  waiting: 2,
  samples: ["From: cy@gmail.com · Subject: **hi**"],
  createdAt: 1_000,
  updatedAt: 1_000,
  expiresAt: 2_000_000,
  status: { state: "pending" },
  ...overrides,
})

describe("sender questions in Discord", () => {
  it("round-trips every choice through a custom id and refuses others", () => {
    for (const choice of [
      "allow-address",
      "allow-domain",
      "deny-address",
      "deny-domain",
    ] as const) {
      expect(decodeInquiryCustomId(encodeInquiryCustomId("snd-1", choice))).toEqual({
        inquiryId: "snd-1",
        choice,
      })
    }
    expect(decodeInquiryCustomId("dshs:snd-1:zz")).toBeUndefined()
    expect(decodeInquiryCustomId("dshc:act-1:a")).toBeUndefined()
  })

  it("offers only the choices the inquiry offers, as buttons, and none once it is settled", () => {
    const card = renderInquiryCard(inquiry(), "discord", "en")
    const buttons = card.components.flat().map((item) => (item.kind === "button" ? item.label : ""))
    expect(buttons).toEqual(["Allow address", "Deny address", "Deny gmail.com"])
    expect(card.embeds?.[0]?.description).toContain("free mail service")
    expect(card.embeds?.[0]?.description).toContain("```text")
    const answered = renderInquiryCard(
      inquiry({
        status: {
          state: "answered",
          choice: "deny-address",
          origin: { kind: "channel", channelId: "discord", channelName: "Discord", person: "42" },
          at: 3,
        },
      }),
      "discord",
      "ja",
    )
    expect(answered.components).toEqual([])
    expect(answered.content).toBe("🚫 <@42> が Discord でアドレスを拒否。")
  })
})
