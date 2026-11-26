import type { Observable } from "../observable"
import type { SettingsBadge, SettingsBadgeTone } from "../settings-frame/sections"
import type { GlobalSettingsSection } from "./sections"

const RANK: readonly SettingsBadgeTone[] = ["danger", "warning"]

export function worstBadge(badges: readonly (SettingsBadge | null)[]): SettingsBadge | null {
  for (const tone of RANK) {
    const found = badges.find((badge) => badge?.tone === tone)
    if (found !== undefined && found !== null) return found
  }
  return null
}

export function globalSettingsAttention(
  sections: Observable<readonly GlobalSettingsSection[]>,
): Observable<SettingsBadge | null> {
  let sources: readonly Observable<SettingsBadge | null>[] = []
  let listed: readonly GlobalSettingsSection[] | undefined
  const sourcesOf = () => {
    const current = sections.getSnapshot()
    if (current !== listed) {
      listed = current
      sources = current.flatMap((section) =>
        section.badge === undefined ? [] : [section.badge(undefined)],
      )
    }
    return sources
  }
  const read = () => worstBadge(sourcesOf().map((source) => source.getSnapshot()))
  return {
    getSnapshot: read,
    subscribe(listener) {
      let offs: (() => void)[] = []
      let last = read()
      const changed = () => {
        const next = read()
        if (next === last) return
        last = next
        listener()
      }
      const follow = () => {
        for (const off of offs) off()
        offs = sourcesOf().map((source) => source.subscribe(changed))
        changed()
      }
      const offSections = sections.subscribe(follow)
      follow()
      return () => {
        offSections()
        for (const off of offs) off()
      }
    },
  }
}
