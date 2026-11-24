import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CORE_PACKAGE, channelIdProblems, coreDependencyProblems } from "./support/channels"
import { pluginDirectoryNames } from "./support/packages"

/**
 * Design rules that span files or packages (18, 19), checked on every plugin
 * package and, so the checks themselves are known to work, on fixtures under
 * test/fixtures/structure.
 */

const root = fileURLToPath(new URL("..", import.meta.url))
const fixtures = join(root, "test", "fixtures", "structure", "packages")
const channels = pluginDirectoryNames(root).filter((name) => `@1outres/${name}` !== CORE_PACKAGE)

describe("channel plugins", () => {
  it("depend on bot-core and inject bot when they import it (rule 18)", () => {
    expect(
      channels.flatMap((name) =>
        coreDependencyProblems(join(root, "packages", name)).map(
          (problem) => `${name}: ${problem}`,
        ),
      ),
    ).toEqual([])
  })

  it("register only their own channel id (rule 19)", () => {
    expect(
      channels.flatMap((name) =>
        channelIdProblems(join(root, "packages", name), name).map(
          (problem) => `${name}: ${problem}`,
        ),
      ),
    ).toEqual([])
  })
})

describe("structure rule checks", () => {
  it("accept a channel plugin that follows rules 18 and 19", () => {
    const directory = join(fixtures, "dsh-bot-good")
    expect(coreDependencyProblems(directory)).toEqual([])
    expect(channelIdProblems(directory, "dsh-bot-good")).toEqual([])
  })

  it("report a channel plugin that breaks rules 18 and 19", () => {
    const directory = join(fixtures, "dsh-bot-bad")
    expect(coreDependencyProblems(directory)).toEqual([
      "src/channel.ts imports @1outres/dsh-bot-core, which neither dependencies nor peerDependencies lists",
      'src/index.ts inject does not list "bot"',
    ])
    expect(channelIdProblems(directory, "dsh-bot-bad")).toEqual([
      'src/channel.ts registers channel "discord"; expected "bad"',
      'src/channel.ts registers channel "other"; expected "bad"',
    ])
  })

  it("accept bot-core as a peer dependency (rule 18)", () => {
    expect(coreDependencyProblems(join(fixtures, "dsh-bot-peer"))).toEqual([])
  })

  it("ignore a package that does not import bot-core", () => {
    expect(coreDependencyProblems(join(fixtures, "dsh-bot-plain"))).toEqual([])
  })
})
