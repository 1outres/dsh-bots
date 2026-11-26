import type { Translate } from "../dsh/context"

export interface RefusedFileTabProps {
  readonly t: Translate
}

export function RefusedFileTab({ t }: RefusedFileTabProps) {
  return (
    <p className="dshb-files-note" role="alert">
      {t("files.refused.lockdown")}
    </p>
  )
}
