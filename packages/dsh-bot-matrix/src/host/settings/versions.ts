export const MIN_VERSION = "v1.11"

function parts(version: string): readonly [number, number] | undefined {
  const match = /^v(\d+)\.(\d+)$/.exec(version)
  return match === null ? undefined : [Number(match[1]), Number(match[2])]
}

export function supportsVersion(versions: readonly string[]): boolean {
  const [major, minor] = parts(MIN_VERSION) as readonly [number, number]
  return versions.some((version) => {
    const found = parts(version)
    return found !== undefined && (found[0] > major || (found[0] === major && found[1] >= minor))
  })
}
