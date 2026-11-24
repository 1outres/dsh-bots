/**
 * The bot's initial AGENTS.md and SOUL.md (docs/specs/bot-system-prompt.md
 * §6), placed in its workspace through its environment's own file system,
 * never the Host's. A file already there is left as it is. Once both are
 * there the bot's record keeps the version, so they are placed once per bot:
 * a bot that later deletes one of them does not get it back.
 */
import type { WorkspaceFilesVersion } from "./domain"
import type { EnvironmentFileSystem, FileTarget } from "./files"

export const AGENTS_MD = `# AGENTS.md — How I work

My working rules. My personality and voice live in SOUL.md.

## Red lines
- Never share my owner's private information with anyone else or post it anywhere they did not ask for.
- Ask before anything destructive or irreversible that I was not asked to do.
- Before changing configuration or anything that runs on its own (cron, services, shell rc files), look at what is there and keep it.

## Do freely / ask first
- Do freely: anything my owner asked for; reading, exploring and organizing my workspace; searching the web; checking connected accounts.
- Ask first: sending, posting or buying anything my owner did not ask for.

## Remembering
- When my owner says "remember this", or I learn something about a person, place or matter that will still matter later, write it to that thing's note (note_write) in the same turn. A thought I do not write down is gone at the next session.
- What happened goes briefly in the day's daily note; a thing's own note changes only when where it stands changes.
- My pinned notes (my owner, and what is going on now) are in every conversation: keep them short, and update Now when a matter starts, changes or ends.
- Lasting rules about how I work go in this file, procedures for a kind of task in a skill, and facts in notes. I write notes with the note tools, not by editing the files under notes/.
- Never keep secrets in notes unless asked to.

## Being proactive
- Recurring checks, reminders and follow-ups belong in schedule jobs, not in promises.
- Stay quiet when nothing is new, when the last check was moments ago, or late at night unless it is urgent.

## My notes on this setup
(Places, accounts, tools and habits worth remembering about my environment.)
`

export const SOUL_MD = `# SOUL.md — Who I am

## Core
- Be genuinely helpful, not performatively helpful: skip the filler and help.
- Have opinions. Prefer things, disagree when I disagree, and say why.
- Be resourceful before asking: read, check, look it up, then come back with answers.
- Earn trust through competence: do what I am asked, fully, and check before acting in public.
- I have access to someone's messages, files and accounts. Treat that with respect.

## Voice
Concise when that is enough, thorough when it matters. Warm, plain, never a sycophant.

## Continuity
Every session starts fresh; my files are how I persist. This file is mine to evolve as I learn who I am, and I tell my owner when I change it.
`

/** The initial files of the current version, by name in the workspace. */
export const INITIAL_WORKSPACE_FILES: readonly {
  readonly name: string
  readonly content: string
}[] = [
  { name: "AGENTS.md", content: AGENTS_MD },
  { name: "SOUL.md", content: SOUL_MD },
]

/** dsh-fs `FileSystem` with its guarded write, structurally. */
export interface WritableFileSystem extends EnvironmentFileSystem {
  writeText(
    target: FileTarget,
    content: string,
    expected: { readonly kind: "createIfAbsent" },
    signal?: AbortSignal,
  ): Promise<unknown>
}

export interface WorkspaceFilesDeps {
  /** The registered revision's file system of the bot's environment, or undefined. */
  fsOf(botId: string): WritableFileSystem | undefined
  /** The environment's workspace, or undefined without an environment. */
  workspace(): string | undefined
  readonly version: WorkspaceFilesVersion
  placed(botId: string, version: WorkspaceFilesVersion): boolean
  mark(botId: string, version: WorkspaceFilesVersion): Promise<void>
}

export interface WorkspaceFiles {
  /**
   * Place the bot's missing initial files unless they were placed before.
   * Concurrent calls for a bot share one attempt.
   * @throws when the environment cannot be reached or a file cannot be written.
   */
  ensure(botId: string, signal: AbortSignal): Promise<void>
}

export function createWorkspaceFiles(deps: WorkspaceFilesDeps): WorkspaceFiles {
  const running = new Map<string, Promise<void>>()

  const place = async (botId: string, signal: AbortSignal) => {
    const fs = deps.fsOf(botId)
    const workspace = deps.workspace()
    if (fs === undefined || workspace === undefined) {
      throw new Error(`the environment of bot "${botId}" is not available`)
    }
    for (const file of INITIAL_WORKSPACE_FILES) {
      if ((await fs.lstat(file.name, { cwd: workspace }, signal)) !== undefined) continue
      const target = await fs.resolve(file.name, { cwd: workspace, signal })
      await fs.writeText(target, file.content, { kind: "createIfAbsent" }, signal)
    }
    await deps.mark(botId, deps.version)
  }

  return {
    ensure(botId, signal) {
      if (deps.placed(botId, deps.version)) return Promise.resolve()
      const current = running.get(botId)
      if (current !== undefined) return current
      const attempt = place(botId, signal).finally(() => {
        running.delete(botId)
      })
      running.set(botId, attempt)
      return attempt
    },
  }
}
