export const REMOVE = { kind: "remove" }

export function replaceWith(text) {
  return { kind: "replace", text }
}

export function violation(comment, rule, message, fix) {
  return {
    file: comment.file,
    line: comment.line,
    column: comment.column,
    span: comment.span,
    rule,
    message,
    fix,
  }
}

export function directiveText(kind, content) {
  return kind === "jsx" ? `{/* ${content} */}` : `// ${content}`
}
