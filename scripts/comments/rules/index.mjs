import { evaluateBiomeIgnore } from "./biome-ignore.mjs"
import { evaluateComment } from "./no-comments.mjs"
import { evaluateTypescriptDirective } from "./ts-directives.mjs"

export function evaluate(comment, directive, context) {
  switch (directive.kind) {
    case "hashbang":
      return null
    case "biome-ignore":
      return evaluateBiomeIgnore(comment, directive, context)
    case "typescript":
      return evaluateTypescriptDirective(comment, directive, context)
    default:
      return evaluateComment(comment, directive)
  }
}
