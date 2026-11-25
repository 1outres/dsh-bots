import type { VaultSite } from "../../shared/vaults"

const WILDCARD = /^(https:\/\/)\*\.(.+)$/

/** Sites as the owner types them: one origin per line, `https://*.host` for its subdomains too. */
export function sitesText(sites: readonly VaultSite[]): string {
  return sites
    .map((site) => (site.subdomains ? site.origin.replace("https://", "https://*.") : site.origin))
    .join("\n")
}

export function parseSites(text: string): VaultSite[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const wildcard = WILDCARD.exec(line)
      return wildcard === null
        ? { origin: line.replace(/\/+$/, ""), subdomains: false }
        : { origin: `${wildcard[1]}${wildcard[2]}`.replace(/\/+$/, ""), subdomains: true }
    })
}
