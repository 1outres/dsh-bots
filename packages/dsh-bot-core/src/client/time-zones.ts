import type { Choice } from "./ui/choices"

/** The zone every list starts with: browsers list only regional zones. */
const UTC = "UTC"

/** The IANA time zones to pick from, the saved one always among them. */
export function timeZoneChoices(saved: string): readonly Choice<string>[] {
  const zones = [UTC, ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== UTC)]
  const listed = zones.includes(saved) ? zones : [saved, ...zones]
  return listed.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))
}
