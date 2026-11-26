import MarkdownIt from "markdown-it"

const renderer = new MarkdownIt({ html: false, linkify: true, breaks: true })

export interface MatrixText {
  readonly body: string
  readonly format: "org.matrix.custom.html"
  readonly formatted_body: string
}

export function matrixText(markdown: string): MatrixText {
  return {
    body: markdown,
    format: "org.matrix.custom.html",
    formatted_body: renderer.render(markdown).trim(),
  }
}

export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_~|>#[\]()<]/g, (character) => `\\${character}`)
}
