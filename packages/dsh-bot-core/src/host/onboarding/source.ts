import { isVersion } from "../../shared/release-notes"

/** A GitHub repository, as its releases are read. */
export interface GitHubRepository {
  readonly owner: string
  readonly name: string
}

/** Where dsh-bots' release notes come from: the running version and the repository that releases it. */
export interface ReleaseSource {
  readonly version: string
  readonly repository: GitHubRepository
}

const GITHUB_URL =
  /^(?:git\+)?https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/

/**
 * bot-core's package manifest as the release source: its `version` (every
 * dsh-bots package has the same) and its GitHub `repository`.
 * @throws when either is missing or not one this can read.
 */
export function releaseSourceOf(manifest: unknown): ReleaseSource {
  if (typeof manifest !== "object" || manifest === null) throw new Error("the manifest is missing")
  const { version, repository } = manifest as { version?: unknown; repository?: unknown }
  if (!isVersion(version))
    throw new Error("the manifest's version is not a MAJOR.MINOR.PATCH version")
  const url =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" && repository !== null
        ? (repository as { url?: unknown }).url
        : undefined
  const match = typeof url === "string" ? GITHUB_URL.exec(url) : null
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error("the manifest's repository is not a GitHub repository URL")
  }
  return { version, repository: { owner: match[1], name: match[2] } }
}
