import type { SenderChoice, SenderInquiryView, SenderRuleOrigin } from "../../shared/senders"
import type { MessageKey } from "../i18n"
import type { Translate } from "../types"

const CHOICE_KEY: Readonly<Record<SenderChoice, MessageKey>> = {
  "allow-address": "senders.choice.allow-address",
  "allow-domain": "senders.choice.allow-domain",
  "deny-address": "senders.choice.deny-address",
  "deny-domain": "senders.choice.deny-domain",
}

export function choiceText(t: Translate, choice: SenderChoice, domain: string): string {
  return t(CHOICE_KEY[choice], { domain })
}

export function originText(t: Translate, origin: SenderRuleOrigin): string {
  return origin.kind === "web"
    ? t("senders.origin.web")
    : t("senders.origin.channel", { channel: origin.channelName, person: origin.person })
}

export type InquiryTone = "warning" | "success" | "idle"

export function inquiryTone(inquiry: SenderInquiryView): InquiryTone {
  switch (inquiry.status.state) {
    case "pending":
      return "warning"
    case "answered":
      return inquiry.status.choice.startsWith("allow") ? "success" : "idle"
    case "covered":
      return inquiry.status.verdict === "allow" ? "success" : "idle"
    case "expired":
      return "idle"
  }
}

export function inquiryOutcome(t: Translate, inquiry: SenderInquiryView): string | undefined {
  const { status } = inquiry
  switch (status.state) {
    case "pending":
      return undefined
    case "answered":
      return t("senders.outcome.answered", {
        choice: choiceText(t, status.choice, inquiry.domain),
        origin: originText(t, status.origin),
      })
    case "covered":
      return t(
        status.verdict === "allow"
          ? "senders.outcome.covered.allow"
          : "senders.outcome.covered.deny",
      )
    case "expired":
      return t("senders.outcome.expired")
  }
}
