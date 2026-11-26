export function versionProblems(tag, releaseEnv, manifests) {
  const version = releaseEnv.DSH_BOTS_VERSION
  const problems = []
  if (tag !== `v${version}`) {
    problems.push(
      `The tag is ${tag}, but infra/release.env names DSH_BOTS_VERSION=${version}. Push the tag v${version}, or merge a release.env and package versions for ${tag} to main first.`,
    )
  }
  for (const { path, manifest } of manifests) {
    if (manifest.version !== version) {
      problems.push(
        `${path} has version ${manifest.version}, but infra/release.env names ${version}. Give every package the version ${version}.`,
      )
    }
  }
  return problems
}
