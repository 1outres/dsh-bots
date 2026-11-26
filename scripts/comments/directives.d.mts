import type { Directive, LanguageId, SourceComment } from "./contract.mjs"

export function classifyComment(comment: SourceComment, language: LanguageId): Directive
