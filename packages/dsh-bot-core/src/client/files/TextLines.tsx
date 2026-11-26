import { useEffect, useRef } from "react"
import type { TextPreview } from "./preview"

export function TextLines({ preview }: { preview: TextPreview }) {
  const target = useRef<HTMLDivElement>(null)
  useEffect(() => {
    target.current?.scrollIntoView({ block: "center" })
  }, [preview.line, preview.absolutePath])
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: -
    <pre className="dshb-files-code" tabIndex={0}>
      {preview.lines.map((text, index) => {
        const number = preview.start + index
        const current = number === preview.line
        return (
          <div
            key={index}
            ref={current ? target : undefined}
            className="dshb-files-line"
            data-current={current ? "" : undefined}
          >
            <span className="dshb-files-number" aria-hidden="true">
              {number}
            </span>
            <code>{text === "" ? " " : text}</code>
          </div>
        )
      })}
    </pre>
  )
}
