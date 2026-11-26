import type { Diagnostic, Directive, RuleContext, SourceComment } from "../contract.mjs"

export function evaluate(
  comment: SourceComment,
  directive: Directive,
  context: RuleContext,
): Diagnostic | null
