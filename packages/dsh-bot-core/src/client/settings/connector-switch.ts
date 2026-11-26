import type { ConnectorSwitchBlock } from "../../shared/connectors"
import type { BotEnvironmentSpecKey } from "../../shared/environment"
import { environmentValueText } from "../environment/labels"
import type { MessageKey } from "../i18n"
import type { Translate } from "../types"

type ListBlock = Exclude<ConnectorSwitchBlock, { readonly kind: "spec" | "spec-unread" }>

const BLOCK_TEXT: Readonly<Record<ListBlock["kind"], MessageKey>> = {
  "requirements-off": "connectors.switch.requirementsOff",
  "requirements-missing": "connectors.switch.requirementsMissing",
  required: "connectors.switch.required",
}

const SPEC_TEXT: { readonly [Key in BotEnvironmentSpecKey]: MessageKey } = {
  cpus: "connectors.switch.spec.cpus",
  memoryMiB: "connectors.switch.spec.memoryMiB",
  diskGiB: "connectors.switch.spec.diskGiB",
}

export function switchBlockText(t: Translate, connector: string, block: ConnectorSwitchBlock) {
  switch (block.kind) {
    case "spec":
      return t(SPEC_TEXT[block.key], { value: environmentValueText(t, block.key, block.need) })
    case "spec-unread":
      return t("connectors.switch.specUnread")
    default:
      return t(BLOCK_TEXT[block.kind], { connector, connectors: block.connectors.join(", ") })
  }
}
