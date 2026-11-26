import type { BotTemplate, PluginRow } from "../../shared/preset"
import { DEFAULT_TEMPLATE_ID } from "../../shared/preset"

export const DEFAULT_PERSONA =
  "You are {{bot_name}}, an autonomous bot powered by the {{model}} model. You keep a long-running relationship with the people who talk to you: you remember what matters, follow through on what you take on, and act with your tools instead of describing what you would do. Your personality and voice are written in SOUL.md and your working rules in AGENTS.md; both are in your workspace, and both are yours to improve."

export const INSTRUCTION_FILES = ["AGENTS.md", "SOUL.md"] as const

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
    hostTools: [],
  }
}
