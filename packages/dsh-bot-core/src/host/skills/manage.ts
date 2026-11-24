/**
 * The work of skill_manage (docs/specs/bot-skills.md §3, §4), of the
 * owner's restores in the Web UI and of the daily archive of unused skills
 * (§12). Every change is checked whole before
 * anything is written, and kept as a version; a skill whose files changed
 * outside skill_manage since its latest version first gets a version of
 * what the files hold (origin `files`), so a restore never loses it.
 */
import { z } from "zod"
import type { SkillFile, SkillOperation, SkillOrigin } from "../../shared/skills"
import type { StoredSkillVersion } from "./domain"
import type { SkillDirectory, SkillLibrary, SkillsPlace } from "./library"
import {
  descriptionWarning,
  nameProblem,
  parseSkill,
  SKILL_FILE,
  sameFiles,
  sizeProblem,
  skillDirectory,
  supportPathProblem,
} from "./skill"
import type { SkillStore } from "./store"

/** The tool's name. */
export const SKILL_MANAGE_TOOL = "skill_manage"

export const SKILL_ACTIONS = [
  "list",
  "view",
  "create",
  "patch",
  "write_file",
  "remove_file",
  "archive",
  "restore",
] as const

/** A refusal the model reads and can act on; nothing was written. */
export class SkillToolError extends Error {
  override readonly name = "SkillToolError"
}

/** Who changes a skill. */
export type SkillActor =
  | { readonly kind: "conversation"; readonly agentId: string; readonly sessionId: string }
  /** A background review of `sessionId`'s conversation, run by Agent `agentId`. */
  | { readonly kind: "review"; readonly agentId: string; readonly sessionId: string }
  /** The weekly curation by the model, run by Agent `agentId`. */
  | { readonly kind: "curator"; readonly agentId: string }
  /** The daily archive of unused skills. */
  | { readonly kind: "sweep" }
  | { readonly kind: "owner" }

/** The changes one Agent of a background run may make. */
export const CHANGE_LIMITS = { review: 1, curator: 3 } as const

const LIMIT_REACHED: Readonly<Record<keyof typeof CHANGE_LIMITS, string>> = {
  review: "a review makes at most one change, and this review has made it; reply now",
  curator: "a curation makes at most three changes, and this one has made them; reply now",
}

/** The Agent that acts, for the actors that view before they change. */
const agentOf = (actor: SkillActor): string | undefined =>
  actor.kind === "owner" || actor.kind === "sweep" ? undefined : actor.agentId

/** One bot's skills: what was read of its files, and what each Agent viewed. */
export interface BotSkillsState {
  readonly library: SkillLibrary
  /** Per Agent: the text it last viewed (or wrote) of each skill file, keyed "<name>/<path>". */
  readonly viewed: Map<string, Map<string, string>>
  /** Changes each Agent of a background run (a review, a curation) made. */
  readonly changeCounts: Map<string, number>
}

export interface SkillManagerDeps {
  readonly store: SkillStore
  newId(): string
  now(): number
  /** A day in the bot's time zone, YYYY-MM-DD. */
  day(botId: string, at: number): string
  /** The bot's skills changed: its catalog is read again. */
  changed(botId: string): void
}

const name = z.string().trim().min(1)
const reason = z
  .string()
  .trim()
  .min(1, "give a short reason; your owner sees it in the skill history")

const argsSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({
    action: z.literal("view"),
    name,
    file_path: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
  }),
  z.strictObject({ action: z.literal("create"), name, content: z.string(), reason }),
  z.strictObject({
    action: z.literal("patch"),
    name,
    old_text: z.string().min(1),
    new_text: z.string(),
    file_path: z.string().trim().min(1).optional(),
    reason,
  }),
  z.strictObject({
    action: z.literal("write_file"),
    name,
    file_path: z.string().trim().min(1),
    content: z.string(),
    reason,
  }),
  z.strictObject({
    action: z.literal("remove_file"),
    name,
    file_path: z.string().trim().min(1),
    reason,
  }),
  z.strictObject({
    action: z.literal("archive"),
    name,
    reason,
    absorbed_into: z.string().trim().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("restore"),
    name,
    version: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  }),
])

export type SkillManageArgs = z.infer<typeof argsSchema>

export function parseSkillArgs(args: unknown): SkillManageArgs {
  const result = argsSchema.safeParse(args)
  if (result.success) return result.data
  const issues = result.error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
  )
  throw new SkillToolError(`Invalid arguments: ${issues.join("; ")}`)
}

/** Whether an action changes a skill. */
export const changes = (action: SkillManageArgs["action"]): boolean =>
  action !== "list" && action !== "view"

interface Located {
  readonly archived: boolean
  readonly directory: SkillDirectory
}

const filesOf = (directory: SkillDirectory): SkillFile[] =>
  directory.files.map((file) => ({ path: file.path, text: file.text }))

const occurrences = (text: string, part: string): number => {
  let count = 0
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + part.length)) count += 1
  return count
}

function originOf(actor: SkillActor): SkillOrigin {
  switch (actor.kind) {
    case "conversation":
      return { kind: "conversation", sessionId: actor.sessionId }
    case "review":
      return { kind: "review", sessionId: actor.sessionId }
    case "curator":
    case "sweep":
      return { kind: "curator" }
    case "owner":
      return { kind: "owner" }
  }
}

/** The checked SKILL.md of a set of files, for `name`. */
function checkedSkill(name: string, files: readonly SkillFile[]) {
  const skill = files.find((file) => file.path === SKILL_FILE)
  if (skill === undefined) throw new SkillToolError(`the skill has no ${SKILL_FILE}`)
  const parsed = parseSkill(skill.text)
  if (!parsed.ok) throw new SkillToolError(`${SKILL_FILE}: ${parsed.problem}`)
  if (parsed.value.name !== name) {
    throw new SkillToolError(
      `${SKILL_FILE}: its name "${parsed.value.name}" must be the skill's name "${name}"`,
    )
  }
  const size = sizeProblem(files)
  if (size !== undefined) throw new SkillToolError(size)
  return parsed.value
}

/** An active skill as the daily archive weighs it, after its files were recorded. */
export interface SweptSkill {
  readonly name: string
}

export interface SkillManager {
  /** One skill_manage call (or an owner's restore). @throws {SkillToolError} with what to do instead. */
  run(
    botId: string,
    state: BotSkillsState,
    place: SkillsPlace,
    actor: SkillActor,
    args: SkillManageArgs,
    signal: AbortSignal,
  ): Promise<string>
  /**
   * The daily archive: record every active skill's files that are not its
   * latest version (so each has a version to count from), then archive the
   * ones `select` names, with `reason`. @returns the archived names.
   */
  sweep(
    botId: string,
    state: BotSkillsState,
    place: SkillsPlace,
    select: (skills: readonly SweptSkill[]) => readonly string[],
    reason: string,
    signal: AbortSignal,
  ): Promise<readonly string[]>
}

export function createSkillManager(deps: SkillManagerDeps): SkillManager {
  const { store } = deps

  const versionLine = (botId: string, version: StoredSkillVersion) =>
    `- ${version.id} ${deps.day(botId, version.at)} ${version.operation}${version.archived ? " (archived)" : ""}${version.reason === undefined ? "" : ` — ${version.reason}`}`

  /** Keep what the files hold when it is not the latest version. */
  const observeFiles = async (botId: string, skill: string, located: Located) => {
    const latest = store.versions(botId, skill)[0]
    const files = filesOf(located.directory)
    if (
      latest !== undefined &&
      latest.archived === located.archived &&
      sameFiles(latest.files, files)
    )
      return
    await store.addVersion(botId, skill, {
      id: deps.newId(),
      at: deps.now(),
      operation: "observed",
      origin: { kind: "files" },
      archived: located.archived,
      files,
    })
  }

  const run: SkillManager["run"] = async (botId, state, place, actor, args, signal) => {
    const { library } = state
    const viewedBy = (agentId: string) => {
      let map = state.viewed.get(agentId)
      if (map === undefined) {
        map = new Map()
        state.viewed.set(agentId, map)
      }
      return map
    }
    const agentId = agentOf(actor)
    const remember = (skill: string, path: string, text: string) => {
      if (agentId !== undefined) viewedBy(agentId).set(`${skill}/${path}`, text)
    }
    const requireViewed = (skill: string, path: string, text: string) => {
      if (agentId === undefined) return
      const seen = state.viewed.get(agentId)?.get(`${skill}/${path}`)
      if (seen === undefined) {
        throw new SkillToolError(
          `view skills/${skill}/${path} first (skill_manage action=view name=${skill}${path === SKILL_FILE ? "" : ` file_path=${path}`}): a file is changed only after you have read it`,
        )
      }
      if (seen !== text) {
        throw new SkillToolError(
          `skills/${skill}/${path} changed since you viewed it; view it again before changing it`,
        )
      }
    }
    const locate = async (skill: string): Promise<Located | undefined> => {
      const active = await library.directory(place, skill, false, signal)
      if (active !== undefined) return { archived: false, directory: active }
      const archived = await library.directory(place, skill, true, signal)
      return archived === undefined ? undefined : { archived: true, directory: archived }
    }
    const observe = (skill: string, located: Located) => observeFiles(botId, skill, located)
    const record = async (
      skill: string,
      operation: SkillOperation,
      files: readonly SkillFile[],
      archived: boolean,
      why: string | undefined,
      absorbedInto?: string,
    ) => {
      const id = deps.newId()
      await store.addVersion(botId, skill, {
        id,
        at: deps.now(),
        operation,
        ...(why === undefined ? {} : { reason: why }),
        origin: originOf(actor),
        archived,
        ...(absorbedInto === undefined ? {} : { absorbedInto }),
        files: [...files],
      })
      if (actor.kind === "review" || actor.kind === "curator") {
        state.changeCounts.set(actor.agentId, (state.changeCounts.get(actor.agentId) ?? 0) + 1)
      }
      deps.changed(botId)
      return id
    }
    /** Write `text` at a workspace path, replacing only the version there now. */
    const put = async (path: string, text: string, known: string | undefined) =>
      library.write(
        place,
        path,
        text,
        known === undefined
          ? { kind: "createIfAbsent" }
          : { kind: "replaceIfVersion", version: known },
        signal,
      )
    const requireName = (skill: string) => {
      const problem = nameProblem(skill)
      if (problem !== undefined) throw new SkillToolError(`name: ${problem}`)
    }
    const requireActive = (skill: string, located: Located | undefined): SkillDirectory => {
      if (located === undefined)
        throw new SkillToolError(`no skill "${skill}" (see skill_manage action=list)`)
      if (located.archived) {
        throw new SkillToolError(
          `skill "${skill}" is archived; restore it first (skill_manage action=restore)`,
        )
      }
      return located.directory
    }
    if (
      (actor.kind === "review" || actor.kind === "curator") &&
      changes(args.action) &&
      (state.changeCounts.get(actor.agentId) ?? 0) >= CHANGE_LIMITS[actor.kind]
    ) {
      throw new SkillToolError(LIMIT_REACHED[actor.kind])
    }

    switch (args.action) {
      case "list": {
        const catalog = await library.scan(place, signal)
        const archived = await library.archived(place, signal)
        const used = (skill: string) => {
          const usage = store.usage(botId, skill)
          const when =
            usage.lastUsedAt === undefined
              ? "never used"
              : `last used ${deps.day(botId, usage.lastUsedAt)}`
          return store.kept(botId, skill) ? `${when}; marked keep by your owner` : when
        }
        const lines = [
          ...catalog.skills.map(
            (skill) => `- ${skill.name}: ${skill.description} (${used(skill.name)})`,
          ),
          ...archived.map(
            (entry) =>
              `- ${entry.name} (archived: true): ${entry.skill.ok ? entry.skill.value.description : entry.skill.problem}`,
          ),
        ]
        const invalid = catalog.invalid.map((entry) => `- ${entry.path}: ${entry.problem}`)
        return [
          lines.length === 0 ? "No skills yet." : ["Skills:", ...lines].join("\n"),
          ...(invalid.length === 0
            ? []
            : [["Not loaded (fix or remove them):", ...invalid].join("\n")]),
        ].join("\n\n")
      }
      case "view": {
        requireName(args.name)
        const path = args.file_path ?? SKILL_FILE
        if (args.version !== undefined) {
          const version = store.versions(botId, args.name).find((item) => item.id === args.version)
          if (version === undefined)
            throw new SkillToolError(`skill "${args.name}" keeps no version "${args.version}"`)
          const file = version.files.find((item) => item.path === path)
          if (file === undefined) {
            throw new SkillToolError(
              `version ${version.id} has no ${path}; its files: ${version.files.map((item) => item.path).join(", ")}`,
            )
          }
          return `skills/${args.name}/${path} in version ${version.id}:\n${versionLine(botId, version)}\n\n${file.text}`
        }
        const located = await locate(args.name)
        if (located === undefined)
          throw new SkillToolError(`no skill "${args.name}" (see skill_manage action=list)`)
        const file = located.directory.files.find((item) => item.path === path)
        if (file === undefined) {
          throw new SkillToolError(
            `skill "${args.name}" has no text file ${path}; its files: ${located.directory.files.map((item) => item.path).join(", ")}`,
          )
        }
        if (!located.archived) remember(args.name, path, file.text)
        const where = skillDirectory(args.name, located.archived)
        const parts = [`${where}/${path}${located.archived ? " (archived)" : ""}:`, file.text]
        if (path === SKILL_FILE) {
          const others = located.directory.files.filter((item) => item.path !== SKILL_FILE)
          if (others.length > 0)
            parts.push(["Supporting files:", ...others.map((item) => `- ${item.path}`)].join("\n"))
          if (located.directory.unkept.length > 0) {
            parts.push(
              [
                "Other files (not text, too large or outside the supporting folders; not kept in versions):",
                ...located.directory.unkept.map((item) => `- ${item}`),
              ].join("\n"),
            )
          }
          const versions = store.versions(botId, args.name)
          if (versions.length > 0) {
            parts.push(
              [
                "History (newest first):",
                ...versions.slice(0, 5).map((item) => versionLine(botId, item)),
              ].join("\n"),
            )
          }
        }
        return parts.join("\n\n")
      }
      case "create": {
        requireName(args.name)
        const located = await locate(args.name)
        if (located !== undefined) {
          throw new SkillToolError(
            located.archived
              ? `an archived skill is named "${args.name}"; restore it (skill_manage action=restore) or choose another name`
              : `skill "${args.name}" exists; view and patch it instead`,
          )
        }
        const files = [{ path: SKILL_FILE, text: args.content }]
        const skill = checkedSkill(args.name, files)
        await put(`${skillDirectory(args.name, false)}/${SKILL_FILE}`, args.content, undefined)
        remember(args.name, SKILL_FILE, args.content)
        const id = await record(args.name, "create", files, false, args.reason)
        return [
          `Created skill ${args.name} (version ${id}).`,
          descriptionWarning(skill.description),
        ]
          .filter(Boolean)
          .join("\n")
      }
      case "patch": {
        requireName(args.name)
        const located = await locate(args.name)
        const directory = requireActive(args.name, located)
        const path = args.file_path ?? SKILL_FILE
        if (path !== SKILL_FILE) {
          const problem = supportPathProblem(path)
          if (problem !== undefined) throw new SkillToolError(`file_path: ${problem}`)
        }
        const file = directory.files.find((item) => item.path === path)
        if (file === undefined)
          throw new SkillToolError(`skill "${args.name}" has no text file ${path}`)
        requireViewed(args.name, path, file.text)
        const count = occurrences(file.text, args.old_text)
        if (count !== 1) {
          throw new SkillToolError(
            count === 0
              ? `old_text does not appear in ${path}; view it and copy the passage exactly`
              : `old_text appears ${count} times in ${path}; include more of the passage so it appears once`,
          )
        }
        const text = file.text.replace(args.old_text, () => args.new_text)
        const files = filesOf(directory).map((item) => (item.path === path ? { path, text } : item))
        const skill = checkedSkill(args.name, files)
        await observe(args.name, located as Located)
        await put(`${skillDirectory(args.name, false)}/${path}`, text, file.version)
        remember(args.name, path, text)
        const id = await record(args.name, "patch", files, false, args.reason)
        return [
          `Patched skills/${args.name}/${path} (version ${id}).`,
          path === SKILL_FILE ? descriptionWarning(skill.description) : undefined,
        ]
          .filter(Boolean)
          .join("\n")
      }
      case "write_file": {
        requireName(args.name)
        const problem = supportPathProblem(args.file_path)
        if (problem !== undefined) throw new SkillToolError(`file_path: ${problem}`)
        const located = await locate(args.name)
        const directory = requireActive(args.name, located)
        const existing = directory.files.find((item) => item.path === args.file_path)
        if (existing !== undefined) requireViewed(args.name, args.file_path, existing.text)
        if (existing === undefined && directory.unkept.includes(args.file_path)) {
          throw new SkillToolError(`${args.file_path} is not a text file skill_manage can replace`)
        }
        const file = { path: args.file_path, text: args.content }
        const files = [...filesOf(directory).filter((item) => item.path !== file.path), file]
        checkedSkill(args.name, files)
        await observe(args.name, located as Located)
        await put(`${skillDirectory(args.name, false)}/${file.path}`, file.text, existing?.version)
        remember(args.name, file.path, file.text)
        const id = await record(args.name, "write_file", files, false, args.reason)
        return `Wrote skills/${args.name}/${file.path} (version ${id}).`
      }
      case "remove_file": {
        requireName(args.name)
        const problem = supportPathProblem(args.file_path)
        if (problem !== undefined) throw new SkillToolError(`file_path: ${problem}`)
        const located = await locate(args.name)
        const directory = requireActive(args.name, located)
        const existing = directory.files.find((item) => item.path === args.file_path)
        if (existing === undefined)
          throw new SkillToolError(`skill "${args.name}" has no text file ${args.file_path}`)
        const files = filesOf(directory).filter((item) => item.path !== args.file_path)
        await observe(args.name, located as Located)
        await library.remove(
          place,
          `${skillDirectory(args.name, false)}/${args.file_path}`,
          existing.version,
          signal,
        )
        const id = await record(args.name, "remove_file", files, false, args.reason)
        return `Removed skills/${args.name}/${args.file_path} (version ${id}).`
      }
      case "archive": {
        requireName(args.name)
        const located = await locate(args.name)
        const directory = requireActive(args.name, located)
        if ((actor.kind === "curator" || actor.kind === "sweep") && store.kept(botId, args.name)) {
          throw new SkillToolError(
            `your owner keeps skill "${args.name}"; a curation never archives it (it may be the skill another is merged into)`,
          )
        }
        if (actor.kind === "curator" && args.absorbed_into === undefined) {
          throw new SkillToolError(
            "a curation archives a skill only when merging it: patch the survivor first, then pass absorbed_into",
          )
        }
        if (args.absorbed_into !== undefined) {
          if (args.absorbed_into === args.name)
            throw new SkillToolError("absorbed_into must name another skill")
          const survivor = (await library.scan(place, signal)).skills.find(
            (skill) => skill.name === args.absorbed_into,
          )
          if (survivor === undefined)
            throw new SkillToolError(`absorbed_into: no active skill "${args.absorbed_into}"`)
        }
        await observe(args.name, located as Located)
        const stale = await library.directory(place, args.name, true, signal)
        if (stale !== undefined) {
          await observe(args.name, { archived: true, directory: stale })
          for (const file of stale.files) {
            await library.remove(
              place,
              `${skillDirectory(args.name, true)}/${file.path}`,
              file.version,
              signal,
            )
          }
        }
        for (const file of directory.files) {
          await put(`${skillDirectory(args.name, true)}/${file.path}`, file.text, undefined)
          await library.remove(
            place,
            `${skillDirectory(args.name, false)}/${file.path}`,
            file.version,
            signal,
          )
        }
        const id = await record(
          args.name,
          "archive",
          filesOf(directory),
          true,
          args.reason,
          args.absorbed_into,
        )
        return [
          `Archived skill ${args.name} (version ${id})${args.absorbed_into === undefined ? "" : `, merged into ${args.absorbed_into}`}.`,
          ...(directory.unkept.length === 0
            ? []
            : [
                `Left in skills/${args.name}/ (not text or not in a supporting folder): ${directory.unkept.join(", ")}`,
              ]),
        ].join("\n")
      }
      case "restore": {
        requireName(args.name)
        const located = await locate(args.name)
        if (located === undefined) {
          throw new SkillToolError(
            `no skill "${args.name}" is in skills/ or skills/.archive/; view its history in your settings`,
          )
        }
        await observe(args.name, located)
        const versions = store.versions(botId, args.name)
        const target =
          args.version !== undefined
            ? versions.find((item) => item.id === args.version)
            : located.archived
              ? versions[0]
              : versions[1]
        if (target === undefined) {
          throw new SkillToolError(
            args.version !== undefined
              ? `skill "${args.name}" keeps no version "${args.version}"`
              : `skill "${args.name}" has no earlier version to go back to; archive it instead`,
          )
        }
        const files = target.files
        checkedSkill(args.name, files)
        const current = new Map(located.directory.files.map((file) => [file.path, file]))
        const active = skillDirectory(args.name, false)
        if (located.archived) {
          const there = await library.directory(place, args.name, false, signal)
          for (const file of files) {
            const known = there?.files.find((item) => item.path === file.path)?.version
            await put(`${active}/${file.path}`, file.text, known)
          }
          for (const file of located.directory.files) {
            await library.remove(
              place,
              `${skillDirectory(args.name, true)}/${file.path}`,
              file.version,
              signal,
            )
          }
        } else {
          for (const file of files) {
            const existing = current.get(file.path)
            if (existing?.text === file.text) continue
            await put(`${active}/${file.path}`, file.text, existing?.version)
          }
          for (const file of located.directory.files) {
            if (!files.some((item) => item.path === file.path)) {
              await library.remove(place, `${active}/${file.path}`, file.version, signal)
            }
          }
        }
        if (agentId !== undefined) {
          const seen = viewedBy(agentId)
          for (const key of [...seen.keys()]) if (key.startsWith(`${args.name}/`)) seen.delete(key)
        }
        const id = await record(
          args.name,
          "restore",
          files,
          false,
          args.reason ?? `back to version ${target.id}`,
        )
        return `Restored skill ${args.name} to version ${target.id} (new version ${id}).`
      }
    }
  }

  return {
    run,
    async sweep(botId, state, place, select, reason, signal) {
      const { library } = state
      const catalog = await library.scan(place, signal)
      for (const skill of catalog.skills) {
        const directory = await library.directory(place, skill.name, false, signal)
        if (directory !== undefined)
          await observeFiles(botId, skill.name, { archived: false, directory })
      }
      const archived: string[] = []
      for (const name of select(catalog.skills.map((skill) => ({ name: skill.name })))) {
        await run(
          botId,
          state,
          place,
          { kind: "sweep" },
          { action: "archive", name, reason },
          signal,
        )
        archived.push(name)
      }
      return archived
    },
  }
}
