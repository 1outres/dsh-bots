import type { Choice } from "./ui/choices"

const UTC = "UTC"

export function timeZoneChoices(saved: string): readonly Choice<string>[] {
  const zones = [UTC, ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== UTC)]
  const listed = zones.includes(saved) ? zones : [saved, ...zones]
  return listed.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))
}
