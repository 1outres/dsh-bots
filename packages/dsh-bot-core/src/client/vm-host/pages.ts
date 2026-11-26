export const SETUP_PAGES = [
  "choose",
  "this-machine",
  "another-machine",
  "existing",
  "move",
  "repair",
  "retry",
  "log",
] as const

export type SetupPage = (typeof SETUP_PAGES)[number]

export const setupPageOf = (detail: string | null): SetupPage | null =>
  SETUP_PAGES.find((page) => page === detail) ?? null
