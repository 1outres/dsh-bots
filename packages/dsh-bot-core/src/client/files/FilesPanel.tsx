import { type KeyboardEvent, useEffect, useMemo, useRef } from "react"
import type { Translate } from "../dsh/context"
import type { RenderFactory } from "../dsh/slots"
import { baseName } from "../file-address"
import { useObservable } from "../hooks"
import { IconArrowLeft, IconRefresh } from "../icons"
import { MARKDOWN_RENDER_LIMIT } from "../markdown"
import { SidePanelFrame } from "../shell/SidePanelFrame"
import type { ViewerContent } from "../viewer"
import { BrowseView } from "./BrowseView"
import { FilePreview } from "./FilePreview"
import type { FilesFace } from "./files-face"
import { MarkdownView } from "./MarkdownView"
import { createPanelFocus, type PanelFocus } from "./panel-focus"

export interface FilesPanelProps {
  readonly t: Translate
  readonly sessionId: string
  readonly face: FilesFace
  readonly renderFactory: RenderFactory
  readonly containerRef: { readonly current: HTMLElement | null }
  readonly returnFocus: () => void
}

type FileContent = Extract<ViewerContent, { kind: "file" }>
type DocumentContent = Extract<ViewerContent, { kind: "document" }>

function titleOf(t: Translate, content: ViewerContent): string {
  switch (content.kind) {
    case "browse":
      return t("files.title")
    case "file":
      return baseName(content.path)
    case "document":
      return content.title
  }
}

export function FilesPanel(props: FilesPanelProps) {
  const { t, sessionId, face, containerRef } = props
  const session = useObservable(face.viewer).sessions[sessionId]
  const focus = useMemo(createPanelFocus, [])
  const heading = useRef<HTMLHeadingElement>(null)
  const previewing = session?.open === true && session.content.kind !== "browse"
  useEffect(() => {
    if (previewing && focus.take("preview")) heading.current?.focus()
  })
  if (session === undefined || !session.open) return null
  const { content } = session

  const close = () => {
    face.viewer.close(sessionId)
    props.returnFocus()
  }
  const refresh = () => {
    if (content.kind !== "browse") {
      face.viewer.refresh(sessionId)
      return
    }
    face.treeOf(sessionId).refresh()
    face.searchOf(sessionId).refresh()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return
    event.preventDefault()
    close()
  }
  const title = titleOf(t, content)

  return (
    <SidePanelFrame
      label={t("files.panel")}
      title={title}
      titleHint={content.kind === "file" ? content.path : title}
      titleRef={heading}
      leading={
        content.kind !== "browse" && (
          <button
            type="button"
            className="dshb-shell-button"
            aria-label={t("files.back")}
            title={t("files.back")}
            onClick={() => {
              focus.request("browser")
              face.viewer.browse(sessionId)
            }}
          >
            <IconArrowLeft size={16} />
          </button>
        )
      }
      trailing={
        content.kind !== "document" && (
          <button
            type="button"
            className="dshb-shell-button"
            aria-label={t("files.refresh")}
            title={t("files.refresh")}
            onClick={refresh}
          >
            <IconRefresh size={16} />
          </button>
        )
      }
      closeLabel={t("files.close")}
      resizeLabel={t("files.resize")}
      onClose={close}
      width={face.width}
      containerRef={containerRef}
      onKeyDown={onKeyDown}
      marks={{ "data-dshb-files": "" }}
    >
      <div className="dshb-files-body">
        <PanelContent {...props} content={content} lastFile={session.lastFile} focus={focus} />
      </div>
    </SidePanelFrame>
  )
}

interface PanelContentProps extends FilesPanelProps {
  readonly content: ViewerContent
  readonly lastFile: string | undefined
  readonly focus: PanelFocus
}

function PanelContent(props: PanelContentProps) {
  const { content } = props
  switch (content.kind) {
    case "browse":
      return <BrowseView {...props} current={props.lastFile} />
    case "file":
      return <FileContentView {...props} content={content} />
    case "document":
      return <DocumentView content={content} />
  }
}

function FileContentView(props: FilesPanelProps & { content: FileContent }) {
  const { t, sessionId, face, content } = props
  const model = face.previewOf(sessionId)
  const { path, line, serial } = content
  const request = useMemo(
    () => ({ path, ...(line === undefined ? {} : { line }), revision: serial }),
    [path, line, serial],
  )
  useEffect(() => model.load(request), [model, request])
  return <FilePreview t={t} model={model} request={request} />
}

function DocumentView({ content }: { content: DocumentContent }) {
  if (content.markdown.length > MARKDOWN_RENDER_LIMIT) {
    return (
      // biome-ignore lint/a11y/noNoninteractiveTabindex: -
      <pre className="dshb-files-code dshb-files-source" tabIndex={0}>
        {content.markdown}
      </pre>
    )
  }
  return (
    <div className="dshb-files-markdown">
      <MarkdownView source={content.markdown} />
    </div>
  )
}
