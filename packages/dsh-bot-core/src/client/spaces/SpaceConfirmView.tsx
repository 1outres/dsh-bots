import { useObservable } from "../hooks"
import { ConfirmDialog } from "../settings-frame/confirmations"
import type { Translate } from "../types"
import type { SpaceConfirmations } from "./confirm"

export interface SpaceConfirmFace {
  readonly confirmations: SpaceConfirmations
}

export function SpaceConfirmView(props: SpaceConfirmFace & { readonly t: Translate }) {
  const { t, confirmations } = props
  const request = useObservable(confirmations.asking)
  if (request === null) return null
  return (
    <ConfirmDialog
      title={request.title}
      description={request.description}
      cancel={t("spaces.confirm.cancel")}
      confirm={request.confirm}
      tone={request.tone}
      onAnswer={confirmations.answer}
      marks={{ "data-dshb-space-confirm": request.tone }}
      acceptMarks={{ "data-dshb-space-confirm-accept": "" }}
    />
  )
}
