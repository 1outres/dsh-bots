import { Fragment, type ReactNode, useMemo } from "react"
import { type Block, type Inline, parseMarkdown } from "../markdown"

/** How a note link is drawn: given, `[[…]]` is read as note links; otherwise as text. */
export type NoteLinkRenderer = (link: Extract<Inline, { kind: "note" }>) => ReactNode

export interface MarkdownViewProps {
  readonly source: string
  readonly noteLink?: NoteLinkRenderer
}

/** Markdown drawn from markdown.ts tokens, never as HTML; links open in a new browser tab. */
export function MarkdownView({ source, noteLink }: MarkdownViewProps) {
  const blocks = useMemo(
    () => parseMarkdown(source, { noteLinks: noteLink !== undefined }),
    [source, noteLink],
  )
  return <>{blocks.map((block, index) => renderBlock(block, index, noteLink))}</>
}

/** One line of inline Markdown (a backlink's line). */
export function InlineMarkdown({
  content,
  noteLink,
}: {
  readonly content: readonly Inline[]
  readonly noteLink?: NoteLinkRenderer
}) {
  return <>{renderInline(content, noteLink)}</>
}

function renderBlock(block: Block, key: number, noteLink: NoteLinkRenderer | undefined): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as const
      return <Tag key={key}>{renderInline(block.content, noteLink)}</Tag>
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.content, noteLink)}</p>
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      )
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>{renderInline(item, noteLink)}</li>
      ))
      return block.ordered ? (
        <ol key={key} start={block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      )
    }
    case "quote":
      return (
        <blockquote key={key}>
          {block.blocks.map((inner, index) => renderBlock(inner, index, noteLink))}
        </blockquote>
      )
    case "rule":
      return <hr key={key} />
  }
}

function renderInline(
  content: readonly Inline[],
  noteLink: NoteLinkRenderer | undefined,
): ReactNode {
  return content.map((inline, index) => (
    <Fragment key={index}>{renderToken(inline, noteLink)}</Fragment>
  ))
}

function renderToken(inline: Inline, noteLink: NoteLinkRenderer | undefined): ReactNode {
  switch (inline.kind) {
    case "text":
      return inline.text
    case "code":
      return <code>{inline.text}</code>
    case "strong":
      return <strong>{renderInline(inline.children, noteLink)}</strong>
    case "em":
      return <em>{renderInline(inline.children, noteLink)}</em>
    case "link":
      return inline.href === undefined ? (
        <span>{renderInline(inline.children, noteLink)}</span>
      ) : (
        <a href={inline.href} target="_blank" rel="noopener noreferrer">
          {renderInline(inline.children, noteLink)}
        </a>
      )
    case "note":
      return noteLink === undefined
        ? `[[${inline.target}${inline.text === undefined ? "" : `|${inline.text}`}]]`
        : noteLink(inline)
  }
}
