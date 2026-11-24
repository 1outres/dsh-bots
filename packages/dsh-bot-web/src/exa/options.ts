/** How the Exa backend calls Exa. Fixed for now: neither the settings screen nor the row config sets them. */
export interface ExaOptions {
  readonly baseURL: string
  readonly searchType: "auto" | "lite" | "deep-lite" | "deep"
  readonly searchContents: "highlights" | "text"
  readonly searchMaxCharacters: number
  readonly fetchMaxCharacters: number
}

export const EXA_OPTIONS: ExaOptions = {
  baseURL: "https://api.exa.ai",
  searchType: "auto",
  searchContents: "highlights",
  searchMaxCharacters: 1000,
  fetchMaxCharacters: 100000,
}
