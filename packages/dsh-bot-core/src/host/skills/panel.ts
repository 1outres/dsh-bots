/**
 * What the `botSkills` Remote serves (docs/specs/bot-skills.md §5): each
 * bot's skills as last read from its environment while the Web UI watches
 * them, their history, the owner's restores (through skill_manage's checks,
 * as versions of origin `owner`), the owner's `keep` marks, and the
 * `skillReview` and `skillCurator` settings. What the store and the
 * schedule add to a skill (its use, its mark, when it is archived) is read
 * when the view is, so the view is current without reading the files again.
 */
import type {
  BotSkillHistory,
  BotSkillSummary,
  BotSkillsView,
  SkillVersion,
  SkillVersionSummary,
} from "../../shared/skills"
import type { BotSkills, SkillsReading } from "./bot-skills"
import type { StoredSkillVersion } from "./domain"
import type { SkillsPlace } from "./library"
import type { SkillRetentions } from "./retention"
import { nameProblem } from "./skill"
import type { SkillStore } from "./store"

export interface SkillPanelDeps {
  skills: Pick<BotSkills, "read" | "manageAsOwner" | "subscribe">
  store: SkillStore
  retentions: Pick<SkillRetentions, "of">
  /** The registered revision's skills place of the bot, or undefined. */
  placeOf(botId: string): SkillsPlace | undefined
  exists(botId: string): boolean
  /** Aborts after the time one reading may take, and when the plugin unloads. */
  deadline(): AbortSignal
}

export interface SkillPanel {
  /** @throws for an unknown bot. */
  view(botId: string): BotSkillsView
  /** Follow the bot's skills while `watching` is held: read them now and after each change. */
  follow(botId: string): () => void
  history(botId: string, name: string): BotSkillHistory
  version(botId: string, name: string, versionId: string): SkillVersion
  restoreVersion(botId: string, name: string, versionId: string): Promise<BotSkillHistory>
  restoreArchived(botId: string, name: string): Promise<BotSkillHistory>
  setReview(botId: string, enabled: unknown): Promise<BotSkillsView>
  setCurator(botId: string, enabled: unknown): Promise<BotSkillsView>
  setKeep(botId: string, name: string, keep: unknown): Promise<BotSkillsView>
  /** The bot's schedule jobs changed: what keeps its skills may have. */
  jobsChanged(): void
  /** Called with the bot id after anything the view shows changed. */
  subscribe(listener: (botId: string) => void): () => void
  dispose(): void
}

type Reading =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly found: SkillsReading }
  | { readonly state: "unavailable"; readonly message: string }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const summaryOf = ({ files: _files, ...summary }: StoredSkillVersion): SkillVersionSummary =>
  summary

export function createSkillPanel(deps: SkillPanelDeps): SkillPanel {
  const libraries = new Map<string, Reading>()
  const followers = new Map<string, number>()
  const listeners = new Set<(botId: string) => void>()
  const publish = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const requireBot = (botId: string) => {
    if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
  }
  const requireName = (name: string) => {
    const problem = nameProblem(name)
    if (problem !== undefined) throw new Error(problem)
  }
  const requirePlace = (botId: string) => {
    const place = deps.placeOf(botId)
    if (place === undefined) throw new Error("the bot's environment is not available")
    return place
  }
  const reading = new Map<string, Promise<void>>()
  const refresh = (botId: string): Promise<void> => {
    const running = reading.get(botId)
    if (running !== undefined) return running.then(() => refresh(botId))
    const work = (async () => {
      const place = deps.placeOf(botId)
      let library: Reading
      if (place === undefined) {
        library = { state: "unavailable", message: "the bot's environment is not available" }
      } else {
        try {
          library = { state: "ready", found: await deps.skills.read(botId, place, deps.deadline()) }
        } catch (error) {
          library = { state: "unavailable", message: messageOf(error) }
        }
      }
      libraries.set(botId, library)
      publish(botId)
    })().finally(() => {
      if (reading.get(botId) === work) reading.delete(botId)
    })
    reading.set(botId, work)
    return work
  }
  const refreshFollowed = (botId: string) => {
    if ((followers.get(botId) ?? 0) > 0) void refresh(botId)
  }
  const publishFollowed = (botId: string) => {
    if ((followers.get(botId) ?? 0) > 0) publish(botId)
  }
  const offs = [deps.skills.subscribe(refreshFollowed), deps.store.subscribe(publishFollowed)]
  const history = (botId: string, name: string): BotSkillHistory => {
    requireBot(botId)
    requireName(name)
    return { name, versions: deps.store.versions(botId, name).map(summaryOf) }
  }
  const summary = (
    botId: string,
    name: string,
    description: string,
    archived: boolean,
  ): BotSkillSummary => {
    const usage = deps.store.usage(botId, name)
    return {
      name,
      description,
      archived,
      keep: deps.store.kept(botId, name),
      ...(archived ? {} : { retention: deps.retentions.of(botId, name) }),
      uses: usage.uses,
      ...(usage.lastUsedAt === undefined ? {} : { lastUsedAt: usage.lastUsedAt }),
      versions: deps.store.versions(botId, name).length,
    }
  }
  const libraryOf = (botId: string): BotSkillsView["library"] => {
    const reading = libraries.get(botId) ?? { state: "loading" }
    if (reading.state !== "ready") return reading
    const { found } = reading
    return {
      state: "ready",
      skills: [
        ...found.active.map((skill) => summary(botId, skill.name, skill.description, false)),
        ...found.archived.map((skill) => summary(botId, skill.name, skill.description, true)),
      ],
      invalid: found.invalid,
    }
  }
  const view = (botId: string): BotSkillsView => {
    requireBot(botId)
    return {
      botId,
      review: deps.store.reviewEnabled(botId),
      curator: deps.store.curatorEnabled(botId),
      library: libraryOf(botId),
    }
  }
  const requireEnabled = (enabled: unknown): boolean => {
    if (typeof enabled !== "boolean") throw new Error("enabled must be true or false")
    return enabled
  }
  const known = (botId: string, name: string) => {
    const reading = libraries.get(botId)
    return (
      reading?.state === "ready" &&
      [...reading.found.active, ...reading.found.archived].some((skill) => skill.name === name)
    )
  }
  return {
    view,
    follow(botId) {
      requireBot(botId)
      followers.set(botId, (followers.get(botId) ?? 0) + 1)
      void refresh(botId)
      return () => {
        const left = (followers.get(botId) ?? 1) - 1
        if (left > 0) followers.set(botId, left)
        else {
          followers.delete(botId)
          libraries.delete(botId)
        }
      }
    },
    history,
    version(botId, name, versionId) {
      requireBot(botId)
      requireName(name)
      const version = deps.store.versions(botId, name).find((item) => item.id === versionId)
      if (version === undefined) throw new Error(`skill "${name}" keeps no version "${versionId}"`)
      return version
    },
    async restoreVersion(botId, name, versionId) {
      requireBot(botId)
      requireName(name)
      await deps.skills.manageAsOwner(
        botId,
        requirePlace(botId),
        { action: "restore", name, version: versionId },
        deps.deadline(),
      )
      return history(botId, name)
    },
    async restoreArchived(botId, name) {
      requireBot(botId)
      requireName(name)
      const reading = libraries.get(botId)
      const archived =
        reading?.state === "ready" && reading.found.archived.some((skill) => skill.name === name)
      if (!archived) throw new Error(`skill "${name}" is not archived`)
      await deps.skills.manageAsOwner(
        botId,
        requirePlace(botId),
        { action: "restore", name },
        deps.deadline(),
      )
      return history(botId, name)
    },
    async setReview(botId, enabled) {
      requireBot(botId)
      await deps.store.setReview(botId, requireEnabled(enabled))
      return view(botId)
    },
    async setCurator(botId, enabled) {
      requireBot(botId)
      await deps.store.setCurator(botId, requireEnabled(enabled))
      return view(botId)
    },
    async setKeep(botId, name, keep) {
      requireBot(botId)
      requireName(name)
      if (typeof keep !== "boolean") throw new Error("keep must be true or false")
      if (!known(botId, name)) throw new Error(`the bot has no skill "${name}"`)
      await deps.store.setKeep(botId, name, keep)
      return view(botId)
    },
    jobsChanged() {
      for (const botId of followers.keys()) publishFollowed(botId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      for (const off of offs) off()
    },
  }
}
