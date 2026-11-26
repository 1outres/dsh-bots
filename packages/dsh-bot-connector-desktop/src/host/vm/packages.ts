import list from "../../../debian-packages.txt"

const PACKAGE_NAME = /^[a-z0-9][a-z0-9+.-]+$/

export function parsePackageList(text: string): readonly string[] {
  if (!text.endsWith("\n")) throw new Error("the package list does not end with a newline")
  const names = text.slice(0, -1).split("\n")
  for (const [index, name] of names.entries()) {
    if (!PACKAGE_NAME.test(name)) {
      throw new Error(
        `line ${index + 1} of the package list is not a package name: ${JSON.stringify(name)}`,
      )
    }
  }
  const repeated = names.find((name, index) => names.indexOf(name) !== index)
  if (repeated !== undefined) throw new Error(`the package list names ${repeated} twice`)
  return names
}

export const DESKTOP_PACKAGES = parsePackageList(list)
