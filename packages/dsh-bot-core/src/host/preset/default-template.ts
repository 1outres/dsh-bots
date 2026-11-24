/**
 * The built-in `default` bot template: the smallest composition a bot needs
 * to hold a conversation and work in its own directory. It follows the rows of
 * DSH's shipped `standard` preset (`dsh-web-app/presets/standard.patch.yml`)
 * and keeps their ids, so an overlay written against one reads the same
 * against the other.
 *
 * Kept from `standard`:
 * - `persona`, `agent-instructions` (the bot's AGENTS.md and SOUL.md), `time-context`;
 * - `tool-bash`, `tool-jobs` (background commands),
 *   `tool-fs`, `tool-fs-search`;
 * - `tool-skill` (the catalog and the `skill` loader); its skills are the bot's
 *   skills/, from bot-core's own skills row in the bot's group, so
 *   `skill-filesystem` is left out (docs/specs/bot-skills.md §2);
 * - the `compaction` group, so a long-lived Main session keeps fitting;
 * - `tool-web`, so a bot can look things up while it talks;
 * - `tool-ask-user` (`ask_user_question`, blocking as in `standard`): bot-core
 *   answers a bot's questions itself, in the bot session's own card in the
 *   Web UI and in the Main session's channels.
 *
 * Left out, each addable through an overlay: the `dsh-doc` skill directory
 * (it teaches DSH customization, a coding-agent concern), plan mode, goals,
 * todos, delegation (subagents and workflows start their own Agents), DSH's
 * schedule tool (it can open new sessions outside `Bot.createSession`; bots
 * schedule with bot-core's own `schedule`, below),
 * Office (document work that a chat channel cannot show), and the plugin
 * manager tools.
 *
 * Every template also gets `present` (files the Main session presents also
 * go to the bot's chat channels) from bot-core's own present row,
 * `stay_silent` (a turn's remaining replies kept off them) from its channel
 * row, `schedule` / `schedule_result` (the bot's own scheduled jobs)
 * from its schedule row, and the bot's skills/ with `skill_manage` from its
 * skills row, outside the template.
 *
 * Dropped: `tool-pwsh`. Every row runs inside the bot's environment (a Linux
 * VM), whatever the Host's platform, so the shell is always bash.
 */
import type { BotTemplate, PluginRow } from "../../shared/preset"
import { DEFAULT_TEMPLATE_ID } from "../../shared/preset"

/** docs/specs/bot-system-prompt.md §2.1; `{{bot_name}}` is bot-core's prompt row's variable. */
export const DEFAULT_PERSONA =
  "You are {{bot_name}}, an autonomous bot powered by the {{model}} model. You keep a long-running relationship with the people who talk to you: you remember what matters, follow through on what you take on, and act with your tools instead of describing what you would do. Your personality and voice are written in SOUL.md and your working rules in AGENTS.md; both are in your workspace, and both are yours to improve."

/** The bot's own instruction files in its workspace (§4): its working rules and its personality. */
export const INSTRUCTION_FILES = ["AGENTS.md", "SOUL.md"] as const

/** The `default` template; a fresh object on every call. */
export function defaultTemplate(): BotTemplate {
  const plugins: PluginRow[] = [
    { id: "persona", name: "@deepseek-ai/dsh-persona", config: { prefix: DEFAULT_PERSONA } },
    {
      id: "agent-instructions",
      name: "@deepseek-ai/dsh-agent-instructions",
      config: { maxBytes: 65536, instructionFileCandidates: [...INSTRUCTION_FILES] },
    },
    { id: "time-context", name: "@deepseek-ai/dsh-time-context" },
    { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash" },
    { id: "tool-fs", name: "@deepseek-ai/dsh-tool-fs", config: { applyPatch: false } },
    {
      id: "tool-fs-search",
      name: "@deepseek-ai/dsh-tool-fs-search",
      config: { sampleOverCapGlobResults: false },
    },
    { id: "tool-jobs", name: "@deepseek-ai/dsh-tool-jobs" },
    { id: "tool-ask-user", name: "@deepseek-ai/dsh-tool-ask-user" },
    { id: "tool-skill", name: "@deepseek-ai/dsh-tool-skill" },
    {
      id: "compaction",
      name: "cordis:group",
      group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { id: "compaction-basic", name: "@deepseek-ai/dsh-compaction-basic" },
        { id: "command-compact", name: "@deepseek-ai/dsh-command-compact" },
        {
          id: "tool-result-pruner",
          name: "@deepseek-ai/dsh-compaction-tool-result-pruner",
          config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
        },
      ],
    },
    {
      id: "tool-web",
      name: "@deepseek-ai/dsh-tool-web",
      config: { fetch: true, searchTimeoutMs: 60000 },
    },
  ]
  return {
    id: DEFAULT_TEMPLATE_ID,
    name: "Default",
    description:
      "Conversation, files, shell, skills, web lookup, questions to the user and compaction.",
    plugins,
    // Every Host (global) tool stays hidden; the rows above carry what a bot uses.
    hostTools: [],
  }
}
