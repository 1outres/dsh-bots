import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const GROUP_REFERENCE = /^#\/\$defs\/SeverityOr([A-Za-z0-9]+)$/
const RULE_REFERENCE = /^#\/\$defs\/[A-Za-z0-9]+Configuration$/

function referencesOf(property) {
  return (property.anyOf ?? []).flatMap((option) =>
    option.$ref === undefined ? [] : [option.$ref],
  )
}

export function biomeRulesOf(schema) {
  const groups = Object.entries(schema.$defs.Rules.properties).flatMap(([group, property]) => {
    const definition = referencesOf(property)
      .map((reference) => GROUP_REFERENCE.exec(reference)?.[1])
      .find((name) => name !== undefined)
    return definition === undefined ? [] : [{ group, definition: schema.$defs[definition] }]
  })
  if (groups.length === 0) throw new Error("the Biome schema lists no rule groups")
  return new Set(
    groups.flatMap(({ group, definition }) =>
      Object.entries(definition.properties)
        .filter(([, property]) =>
          referencesOf(property).some((reference) => RULE_REFERENCE.test(reference)),
        )
        .map(([rule]) => `lint/${group}/${rule}`),
    ),
  )
}

export function loadBiomeRules() {
  const path = createRequire(import.meta.url).resolve("@biomejs/biome/configuration_schema.json")
  return biomeRulesOf(JSON.parse(readFileSync(path, "utf8")))
}
