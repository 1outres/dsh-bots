import { directiveText, replaceWith, violation } from "./diagnostic.mjs"

const MESSAGES = {
  reason:
    "Design rule 74: do not explain a biome-ignore; write `// biome-ignore lint/<group>/<rule>: -` (`{/* biome-ignore lint/<group>/<rule>: - */}` as a JSX child), because comments are forbidden (rule 73) and Biome requires a reason.",
  form: "Design rule 74: do not write a biome-ignore as a block comment; write `// biome-ignore lint/<group>/<rule>: -` (the `{/* ... */}` form only as a JSX child), because one directive form keeps every suppression findable.",
  range:
    "Design rule 74: do not use biome-ignore-all, biome-ignore-start or biome-ignore-end; suppress one line with `// biome-ignore lint/<group>/<rule>: -`, because a range suppression also hides diagnostics added later.",
  notLint:
    "Design rule 74: do not suppress anything but a lint rule; name one rule as `lint/<group>/<rule>`, because format, assist and syntax suppressions hide problems no rule reports.",
  broad:
    "Design rule 74: do not suppress a whole Biome category or group; name one rule as `lint/<group>/<rule>`, because a broad suppression hides unrelated diagnostics.",
  plugin:
    "Design rule 74: do not suppress lint/plugin; change the code the GritQL design rule reports or add an exception to the plugin's includes in biome.json, because lint/plugin carries the design rules.",
  carrier:
    "Design rule 74: do not suppress lint/style/noRestrictedImports or lint/style/noRestrictedGlobals; follow the design rule they report or add an exception in biome.json, because they carry design rules 9-16, 26, 30, 33 and 35.",
  unknown:
    "Design rule 74: do not name a rule Biome does not have; name an existing rule as `lint/<group>/<rule>`, because an unknown category suppresses nothing.",
}

const DESIGN_RULE_CARRIERS = new Set([
  "lint/style/noRestrictedImports",
  "lint/style/noRestrictedGlobals",
])

function categoryProblem(category, biomeRules) {
  const [head, group, rule, ...rest] = category.split("/")
  if (head !== "lint") return MESSAGES.notLint
  if (group === "plugin") return MESSAGES.plugin
  if (group === undefined || group === "" || rule === undefined || rule === "")
    return MESSAGES.broad
  if (rest.length > 0 || !biomeRules.has(category)) return MESSAGES.unknown
  if (DESIGN_RULE_CARRIERS.has(category)) return MESSAGES.carrier
  return null
}

export function evaluateBiomeIgnore(comment, directive, context) {
  if (directive.variant !== "ignore") return violation(comment, 74, MESSAGES.range, null)
  const problem = categoryProblem(directive.category, context.biomeRules)
  if (problem !== null) return violation(comment, 74, problem, null)
  if (comment.kind === "block") return violation(comment, 74, MESSAGES.form, null)
  const canonical = directiveText(comment.kind, `biome-ignore ${directive.category}: -`)
  return comment.text === canonical
    ? null
    : violation(comment, 74, MESSAGES.reason, replaceWith(canonical))
}
