import { directiveText, replaceWith, violation } from "./diagnostic.mjs"

const MESSAGES = {
  ignore:
    "Design rule 75: do not use @ts-ignore; fix the type, or in a test assert the error with a bare `// @ts-expect-error`, because @ts-ignore keeps silencing after the error is gone.",
  nocheck:
    "Design rule 75: do not use @ts-nocheck; fix the types, because it turns off type checking for the whole file.",
  outsideTests:
    "Design rule 75: do not use @ts-expect-error outside tests; fix the type, because only a test may assert that code must not type-check.",
  form: "Design rule 75: do not write @ts-expect-error as a block comment; write `// @ts-expect-error` (the `{/* @ts-expect-error */}` form only as a JSX child), because one directive form keeps every suppression findable.",
  description:
    "Design rule 75: do not describe a @ts-expect-error; write it bare as `// @ts-expect-error`, because comments are forbidden (rule 73) and the test's name says what it expects.",
}

export function evaluateTypescriptDirective(comment, directive, context) {
  if (directive.name === "ts-ignore") return violation(comment, 75, MESSAGES.ignore, null)
  if (directive.name === "ts-nocheck") return violation(comment, 75, MESSAGES.nocheck, null)
  if (!context.isTest) return violation(comment, 75, MESSAGES.outsideTests, null)
  if (comment.kind === "block") return violation(comment, 75, MESSAGES.form, null)
  const canonical = directiveText(comment.kind, "@ts-expect-error")
  return comment.text === canonical
    ? null
    : violation(comment, 75, MESSAGES.description, replaceWith(canonical))
}
