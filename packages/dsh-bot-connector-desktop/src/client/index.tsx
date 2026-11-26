import type { ConnectorPanelSlot } from "@1outres/dsh-bot-core"
import { DESKTOP_CONNECTOR_ID } from "../shared/connector"
import { DesktopPanel } from "./DesktopPanel"
import type { ClientContext } from "./dsh"
import { en, ja } from "./i18n"

export const inject = ["slots", "locale"]

const NAMESPACE = "bot-connector-desktop"
const SLOT: ConnectorPanelSlot = "bot-core.connector.panel"

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, ja }), "desktop: dictionaries")
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register(
          { name: SLOT, key: DESKTOP_CONNECTOR_ID, locale: NAMESPACE },
          DesktopPanel,
        ),
      ),
    "desktop: panel body",
  )
}
