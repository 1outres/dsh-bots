import { useState } from "react"
import type { Translate } from "../dsh/context"
import { baseName } from "../file-address"
import { useObservable } from "../hooks"
import { Button } from "../ui"
import { FailureNote } from "./FailureNote"
import { MarkdownView } from "./MarkdownView"
import { type PreviewRequest, rendersMarkdown, sameRequest, type TextPreview } from "./preview"
import type { Extension, PreviewModel } from "./preview-model"
import { TextLines } from "./TextLines"

export interface FilePreviewProps {
  readonly t: Translate
  readonly model: PreviewModel
  /** The request on show; the model's state for any other request reads as loading. */
  readonly request: PreviewRequest
}

export function FilePreview({ t, model, request }: FilePreviewProps) {
  const state = useObservable(model)
  if (
    state.status === "idle" ||
    state.status === "loading" ||
    !sameRequest(state.request, request)
  ) {
    return (
      <p className="dshb-files-dim" role="status">
        {t("files.loading")}
      </p>
    )
  }
  if (state.status === "failed") return <FailureNote t={t} failure={state.failure} />
  const { preview } = state
  switch (preview.kind) {
    case "image":
      return (
        <div className="dshb-files-image">
          <img src={preview.src} alt={baseName(request.path)} title={preview.absolutePath} />
        </div>
      )
    case "oversized":
      return (
        <p className="dshb-files-note" role="alert" title={preview.absolutePath}>
          {t("files.error.too-large")}
        </p>
      )
    case "text":
      return <TextView t={t} model={model} preview={preview} extension={state.extension} />
  }
}

function TextView(props: {
  t: Translate
  model: PreviewModel
  preview: TextPreview
  extension: Extension
}) {
  const { t, model, preview, extension } = props
  const [source, setSource] = useState(false)
  const renderable = rendersMarkdown(preview)
  const busy = extension.status === "loading"
  return (
    <div className="dshb-files-preview">
      <div className="dshb-files-path" title={preview.absolutePath}>
        <span>{preview.absolutePath}</span>
        {renderable && (
          <Button variant="row" pressed={source} onClick={() => setSource(!source)}>
            {t("files.source")}
          </Button>
        )}
      </div>
      {renderable && !source ? (
        <div className="dshb-files-markdown">
          <MarkdownView source={preview.lines.join("\n")} />
        </div>
      ) : (
        <>
          {preview.start > 1 && (
            <div className="dshb-files-more">
              <Button variant="row" disabled={busy} onClick={() => model.extend("before")}>
                {t("files.earlier")}
              </Button>
            </div>
          )}
          {extension.status === "failed" && extension.direction === "before" && (
            <FailureNote t={t} failure={extension.failure} />
          )}
          <TextLines preview={preview} />
          {!preview.eof && (
            <div className="dshb-files-more">
              <Button variant="row" disabled={busy} onClick={() => model.extend("after")}>
                {t("files.more")}
              </Button>
            </div>
          )}
          {extension.status === "failed" && extension.direction === "after" && (
            <FailureNote t={t} failure={extension.failure} />
          )}
        </>
      )}
    </div>
  )
}
