import type { Translate } from "../dsh/context"
import { type BotFileFailure, failureKey } from "../file-failure"

export function FailureNote({ t, failure }: { t: Translate; failure: BotFileFailure }) {
  return (
    <p className="dshb-files-note" role="alert" data-dshb-files-failure={failure.kind}>
      {t(failureKey(failure))}
    </p>
  )
}
