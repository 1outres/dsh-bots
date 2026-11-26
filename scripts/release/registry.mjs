/** Whether npm serves each workspace package at its version, from the registry's packuments. */
export async function registryStates(manifests, fetchPackument) {
  return Promise.all(
    manifests.map(async ({ manifest }) => {
      const packument = await fetchPackument(manifest.name)
      const served = packument !== null && Object.hasOwn(packument.versions ?? {}, manifest.version)
      return { name: manifest.name, version: manifest.version, served }
    }),
  )
}

/** What a failed publish left on npm, and what to do about each package npm does not serve. */
export function publishReport(states) {
  const missing = states.filter((state) => !state.served)
  const lines = states.map(
    (state) => `- ${state.name}@${state.version}: ${state.served ? "on npm" : "not on npm"}`,
  )
  if (missing.length === 0) return { lines, advice: [] }
  return {
    lines,
    advice: [
      "Run the failed jobs again once the cause is fixed: packages on npm are skipped.",
      `If the log shows npm accepted the upload of ${missing[0].name}@${missing[0].version} but it never became available, or the retry fails with 409 "Cannot publish over previously staged version", npm holds it as a staged version (npm/cli#9889).`,
      'Look under Staged Packages on npmjs.com: approve it there if it is listed. If it is not, npm will never publish that version: release the next patch version (infra/RELEASING.md, "A version npm will not publish").',
    ],
  }
}
