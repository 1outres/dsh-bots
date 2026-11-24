import { IconClose } from "./icons"
import type { Translate } from "./types"
import { Button } from "./ui/Button"

/** A sidebar row's failure under it, dismissed with ×. */
export function RowError(props: {
  readonly t: Translate
  readonly message: string
  onDismiss(): void
}) {
  const { t } = props
  return (
    <div className="dshb-row-error" role="alert">
      <span className="dshb-row-error-text">{t("error.generic", { message: props.message })}</span>
      <Button variant="icon" label={t("error.dismiss")} onClick={props.onDismiss}>
        <IconClose size={12} />
      </Button>
    </div>
  )
}
