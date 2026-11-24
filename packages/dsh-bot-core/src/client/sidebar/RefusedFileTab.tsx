import type { Translate } from "../dsh/context"

export interface RefusedFileTabProps {
  readonly t: Translate
}

/** The body DSH's seat draws for a bot file tab only when the lockdown failed: a refusal, never the file. */
export function RefusedFileTab({ t }: RefusedFileTabProps) {
  return (
    <p className="dshb-files-note" role="alert">
      {t("files.refused.lockdown")}
    </p>
  )
}
