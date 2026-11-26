import type { Translate } from "../types"
import { Code, CopyButton } from "../ui"

/** A command to run elsewhere (or what to do): its text and a Copy button. */
export function Command({ t, text }: { readonly t: Translate; readonly text: string }) {
  return (
    <span className="dshb-vm-host-command">
      <Code>{text}</Code>
      <CopyButton text={text} label={t("check.copy")} copiedLabel={t("check.copied")} />
    </span>
  )
}
