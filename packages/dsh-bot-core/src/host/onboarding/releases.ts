import {
  compareVersions,
  dueBetween,
  isVersion,
  type ReleaseNote,
} from "../../shared/release-notes"
import type { GitHubRepository } from "./source"

export interface HttpResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export type HttpFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>>; readonly signal: AbortSignal },
) => Promise<HttpResponse>

export interface ReleasesDeps {
  readonly fetch: HttpFetch
  readonly repository: GitHubRepository
}

export const RELEASES_PER_PAGE = 100
export const MAX_RELEASE_PAGES = 10

const HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "dsh-bots",
}

const TAG = /^v(.+)$/

interface GitHubRelease {
  readonly tag: string
  readonly draft: boolean
  readonly body: string
  readonly url: string
}

function releaseOf(item: unknown, index: number): GitHubRelease {
  if (typeof item !== "object" || item === null)
    throw new Error(`release ${index} is not an object`)
  const { tag_name, draft, body, html_url } = item as Record<string, unknown>
  if (typeof tag_name !== "string" || typeof draft !== "boolean" || typeof html_url !== "string") {
    throw new Error(`release ${index} lacks tag_name, draft or html_url`)
  }
  if (body !== null && body !== undefined && typeof body !== "string") {
    throw new Error(`release ${index} has a body that is not text`)
  }
  return { tag: tag_name, draft, body: body ?? "", url: html_url }
}

export function noteOf(release: GitHubRelease): ReleaseNote | undefined {
  const version = TAG.exec(release.tag)?.[1]
  if (release.draft || !isVersion(version) || release.body.trim() === "") return undefined
  return { version, body: release.body, url: release.url }
}

async function page(
  deps: ReleasesDeps,
  number: number,
  signal: AbortSignal,
): Promise<GitHubRelease[]> {
  const { owner, name } = deps.repository
  const url = `https://api.github.com/repos/${owner}/${name}/releases?per_page=${RELEASES_PER_PAGE}&page=${number}`
  const response = await deps.fetch(url, { headers: HEADERS, signal })
  if (!response.ok)
    throw new Error(`GitHub answered ${response.status} for ${owner}/${name}'s releases`)
  const items = await response.json()
  if (!Array.isArray(items)) throw new Error("GitHub's releases are not a list")
  return items.map(releaseOf)
}

export async function fetchDueNotes(
  deps: ReleasesDeps,
  seen: string,
  current: string,
  signal: AbortSignal,
): Promise<ReleaseNote[]> {
  const releases: GitHubRelease[] = []
  for (let number = 1; ; number += 1) {
    if (number > MAX_RELEASE_PAGES)
      throw new Error(`more than ${MAX_RELEASE_PAGES} pages of releases`)
    const items = await page(deps, number, signal)
    releases.push(...items)
    if (items.length < RELEASES_PER_PAGE) break
  }
  return releases
    .map(noteOf)
    .filter(
      (note): note is ReleaseNote => note !== undefined && dueBetween(note.version, seen, current),
    )
    .sort((a, b) => compareVersions(b.version, a.version))
}
