import { REMOVE, replaceWith, violation } from "./diagnostic.mjs"

const MESSAGES = {
  prose:
    "Design rule 73: do not write comments; say it in names, types, tests or docs/, because comments drift from the code and nothing checks them.",
  noqa: "Design rule 73: do not explain or widen a noqa; write exactly `# noqa: CODE[, CODE...]`, because the only comments allowed are bare tool directives.",
  shellcheck:
    "Design rule 73: do not explain a shellcheck directive or use one other than disable, source and shell; write exactly `# shellcheck disable=SCnnnn[,SCnnnn...]`, `# shellcheck source=<path>` or `# shellcheck shell=sh|bash|dash|ksh|busybox`, because the only comments allowed are bare tool directives.",
}

const SHELLCHECK_CODES = /^SC[0-9]+(?:,SC[0-9]+)*$/

const SHELLCHECK_SHELLS = new Set(["sh", "bash", "dash", "ksh", "busybox"])

const SHELLCHECK_VALUES = {
  disable: (value) => SHELLCHECK_CODES.test(value),
  source: (value) => value !== "",
  shell: (value) => SHELLCHECK_SHELLS.has(value),
}

function noqaText(directive) {
  return directive.codes === null ? null : `# noqa: ${directive.codes.join(", ")}`
}

function shellcheckText(directive) {
  const accepts = Object.hasOwn(SHELLCHECK_VALUES, directive.key)
    ? SHELLCHECK_VALUES[directive.key]
    : null
  return accepts?.(directive.value) ? `# shellcheck ${directive.key}=${directive.value}` : null
}

function toolDirective(comment, canonical, message) {
  if (canonical === comment.text) return null
  return violation(comment, 73, message, canonical === null ? REMOVE : replaceWith(canonical))
}

export function evaluateComment(comment, directive) {
  switch (directive.kind) {
    case "prose":
      return violation(comment, 73, MESSAGES.prose, REMOVE)
    case "noqa":
      return toolDirective(comment, noqaText(directive), MESSAGES.noqa)
    case "shellcheck":
      return toolDirective(comment, shellcheckText(directive), MESSAGES.shellcheck)
    default:
      throw new Error(`rule 73 does not judge ${directive.kind} directives`)
  }
}
