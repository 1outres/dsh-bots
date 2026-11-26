import type { BotPromptChannel, BotPromptFacts, BotSessionKind } from "../../internal"
import { CONVERSATIONS_SECTION } from "../conversations/texts"
import { SKILLS_SECTION } from "../skills/texts"
import { VAULT_PROMPT } from "../vaults/texts"
import { renderStatus } from "./status"
import {
  ENVIRONMENT,
  MANAGED_SESSIONS,
  MANAGEMENT_ANSWERS_MAIN,
  MANAGEMENT_ANSWERS_OWNER,
  MANAGEMENT_HEAD,
  MEMORY,
  MESSAGES,
  PRINCIPLES,
  SESSION_CURATOR,
  SESSION_DELEGATED,
  SESSION_MAIN,
  SESSION_SCHEDULE,
  SESSION_SUBAGENT,
  SESSION_WEB,
  WORKSPACE_FILES,
} from "./texts"

export interface BotPromptPart {
  readonly name: string
  readonly order: number
  text(facts: BotPromptFacts): string
}

export const BOT_NAME_VARIABLE = "bot_name"

const SESSION_TEXT: Readonly<Record<BotSessionKind, string>> = {
  main: SESSION_MAIN,
  web: SESSION_WEB,
  delegated: SESSION_DELEGATED,
  schedule: SESSION_SCHEDULE,
  subagent: SESSION_SUBAGENT,
  curator: SESSION_CURATOR,
}

const working = (session: BotSessionKind) => session !== "subagent" && session !== "curator"

const conversing = (session: BotSessionKind) => session === "main" || session === "web"

function messages(channels: readonly BotPromptChannel[]): string {
  const hints = channels.flatMap((channel) =>
    channel.formatHint === undefined ? [] : [`- ${channel.name}: ${channel.formatHint}`],
  )
  return [MESSAGES, ...hints].join("\n")
}

export const BOT_PROMPT_SECTIONS: readonly BotPromptPart[] = [
  { name: "bot:principles", order: 100, text: () => PRINCIPLES },
  { name: "bot:environment", order: 4000, text: () => ENVIRONMENT },
  { name: "bot:session", order: 4100, text: (facts) => SESSION_TEXT[facts.session] },
  {
    name: "bot:managed-sessions",
    order: 4150,
    text: (facts) => (facts.session === "main" ? MANAGED_SESSIONS : ""),
  },
  {
    name: "bot:messages",
    order: 4200,
    text: (facts) => (conversing(facts.session) ? messages(facts.channels) : ""),
  },
  {
    name: "bot:workspace-files",
    order: 4300,
    text: (facts) => (working(facts.session) ? WORKSPACE_FILES : ""),
  },
  {
    name: "bot:memory",
    order: 4400,
    text: (facts) => (working(facts.session) ? MEMORY : ""),
  },
  {
    name: "bot:conversations",
    order: 4450,
    text: (facts) => (conversing(facts.session) ? CONVERSATIONS_SECTION : ""),
  },
  {
    name: "bot:skills",
    order: 4500,
    text: (facts) => (conversing(facts.session) ? SKILLS_SECTION : ""),
  },
]

export const BOT_STATUS_CONTEXT: BotPromptPart = {
  name: "bot:status",
  order: 300,
  text: (facts) => (conversing(facts.session) ? renderStatus(facts.status) : ""),
}
export const BOT_MANAGEMENT_CONTEXT: BotPromptPart = {
  name: "bot:management",
  order: 320,
  text: ({ management }) =>
    management === undefined
      ? ""
      : [
          MANAGEMENT_HEAD,
          management.answerer === "main" ? MANAGEMENT_ANSWERS_MAIN : MANAGEMENT_ANSWERS_OWNER,
        ].join("\n"),
}

export const BOT_LOGINS_CONTEXT: BotPromptPart = {
  name: "bot:logins",
  order: 330,
  text: (facts) => (facts.logins ? VAULT_PROMPT : ""),
}

export const PINNED_NOTES_CONTEXT = { name: "bot:pinned-notes", order: 310 } as const
