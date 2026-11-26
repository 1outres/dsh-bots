export async function registryStates(manifests, fetchPackument) {
  return Promise.all(
    manifests.map(async ({ manifest }) => {
      const packument = await fetchPackument(manifest.name)
      const served = packument !== null && Object.hasOwn(packument.versions ?? {}, manifest.version)
      return { name: manifest.name, version: manifest.version, served }
    }),
  )
}

export function publishReport(states) {
  const missing = states.filter((state) => !state.served)
  const lines = states.map(
    (state) => `- ${state.name}@${state.version}: ${state.served ? "on npm" : "not on npm"}`,
  )
  if (missing.length === 0) return { lines, advice: [] }
  return {
    lines,
    advice: [
      "Packages on npm are skipped when the failed jobs run again.",
      `If npm accepted the upload of ${missing[0].name}@${missing[0].version} and the wait timed out, npm may still be processing it (0.4.1's dsh-bot-connector-desktop took over 10 minutes): wait, check that it is on npm, then run the failed jobs again. A retry before then can fail with 409 "Cannot publish over previously staged version".`,
      'If it is still not on npm after a few hours, look under Staged Packages on npmjs.com (npm/cli#9889): approve it if it is listed; if not, release the next patch version (infra/RELEASING.md, "A version npm is slow to serve").',
    ],
  }
}
