import type { ConnectorText } from "../../shared/connectors"
import type { VaultFieldKind, VaultProviderStatus } from "../../shared/vaults"
import type { Translate } from "../types"
import type { PillTone } from "../ui"

export const kindLabel = (t: Translate, kind: VaultFieldKind) => t(`vaults.kind.${kind}`)

export const kindsLabel = (t: Translate, kinds: readonly VaultFieldKind[]) =>
  kinds.map((kind) => kindLabel(t, kind)).join(", ")

export function providerPill(
  t: Translate,
  status: VaultProviderStatus,
): { readonly tone: PillTone; readonly label: string } {
  switch (status.state) {
    case "ready":
      return { tone: "success", label: t("vaults.provider.ready") }
    case "preparing":
      return { tone: "busy", label: t("vaults.provider.preparing") }
    case "failed":
      return { tone: "danger", label: t("vaults.provider.failed") }
  }
}

/** A provider's text in the user's language. */
export type ResolveText = (text: ConnectorText) => string
