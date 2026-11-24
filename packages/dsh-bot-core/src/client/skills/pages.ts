/** The detail pages of a bot's Skills section, as `page.detail` names them. */
export type SkillsPage =
  | { readonly kind: "list" }
  | { readonly kind: "skill"; readonly name: string }
  | { readonly kind: "version"; readonly name: string; readonly versionId: string }

const SKILL = "skill:"
const VERSION = "version:"

export const skillDetail = (name: string): string => `${SKILL}${name}`

export const versionDetail = (name: string, versionId: string): string =>
  `${VERSION}${name}:${versionId}`

/** The page a detail id names; the list for none or an id of no page. */
export function skillsPageOf(detail: string | null): SkillsPage {
  if (detail?.startsWith(SKILL) === true) return { kind: "skill", name: detail.slice(SKILL.length) }
  if (detail?.startsWith(VERSION) === true) {
    const rest = detail.slice(VERSION.length)
    const at = rest.indexOf(":")
    if (at > 0) return { kind: "version", name: rest.slice(0, at), versionId: rest.slice(at + 1) }
  }
  return { kind: "list" }
}
