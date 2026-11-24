import { useState } from "react"
import { Button } from "./Button"
import type { DataMarks } from "./marks"

/** Whether the page may write the clipboard (a secure context: HTTPS or localhost). */
const clipboardWritable = () =>
  typeof navigator !== "undefined" && navigator.clipboard !== undefined

/**
 * A row button that copies `text` and then reads `copiedLabel`; absent where
 * the page cannot write the clipboard, the value staying selectable beside it.
 */
export function CopyButton(props: {
  readonly text: string
  readonly label: string
  readonly copiedLabel: string
  readonly marks?: DataMarks
}) {
  const [copied, setCopied] = useState<string | null>(null)
  if (!clipboardWritable()) return null
  return (
    <Button
      variant="row"
      onClick={() => {
        navigator.clipboard.writeText(props.text).then(
          () => setCopied(props.text),
          () => setCopied(null),
        )
      }}
      marks={props.marks}
    >
      {copied === props.text ? props.copiedLabel : props.label}
    </Button>
  )
}
