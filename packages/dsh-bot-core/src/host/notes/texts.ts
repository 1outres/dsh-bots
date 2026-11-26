import type { MainMaintenance, MainTurnPrompt } from "../../mains-contract"
import { groupDigits } from "./names"
import { PINNED_LIMIT } from "./pinned"

export const NOTE_NAME_PARAMETER = "The note: its title, or an alias that only one note has."

export const NOTE_READ_DESCRIPTION =
  "Read one of your notes: its summary, its text (links shown as [[Title]] or [[Title|text]]), the notes it links to (Links) and the notes that link to it, each with the linking line (Backlinks). The backlinks of a daily note are what happened that day. " +
  "When a name matches several notes' aliases, the result lists them instead; read the one you mean by its title."

export const NOTE_WRITE_DESCRIPTION =
  "Write your notes. A note holds what you know about one person, place, organization, matter (a request or project), thing (a product, an event…) or topic, written as its current state: rewrite it when things change instead of adding dated entries. A daily note (type daily, titled YYYY-MM-DD in your time zone) holds what happened that day. " +
  "Actions: create (title, type, summary, body; optional aliases, pinned), update (note, and what changes: title, type, aliases, summary, pinned, and the text either as body, which replaces it all, or as edits, each replacing one passage that appears exactly once), append (note, text: added at the end; meant for daily notes, and a daily note that does not exist yet is created). " +
  "Link another note with [[Title]] or [[Title|text]]: a link names one note by its title or by an alias only one note has (otherwise nothing is saved and the result says why), and a link to a date such as [[2026-10-24]] creates that day's note. Titles are unique; aliases may repeat across notes. " +
  "Nothing is linked for you: the result suggests numbered links for words you just wrote that match other notes' names or dated days; link the ones you meant with note_link and leave the rest. " +
  `Pinned notes are loaded in every conversation and hold at most ${groupDigits(PINNED_LIMIT)} characters together; a write that would go over is not saved.`

export const NOTE_WRITE_PARAMETERS = {
  action: "create, update or append.",
  note: `update, append: ${NOTE_NAME_PARAMETER}`,
  title:
    "create; update to rename: unique among your notes, one line without [[, ]] or |. A daily note's title is its date, YYYY-MM-DD.",
  type: "person, place, organization, matter, thing, topic or daily.",
  aliases: "Other names of the thing (update: the whole new list). They may repeat across notes.",
  summary:
    "One line on what the note is about; shown with links, notices and search results. Every note but a daily one has one.",
  pinned: "true to load the note in every conversation, false to stop.",
  body: "create; update: the whole text, replacing the old one.",
  edits:
    "update: replacements in the current text, applied in order; each old appears exactly once.",
  text: "append: the text added at the end.",
} as const

export const NOTE_LINK_DESCRIPTION =
  "Link words that the latest write of a note suggested (its result numbers them L1, L2…). " +
  'apply is a number ("L1"), { "id": "L2", "target": "<title>" } for a suggestion that matches several notes, or a list of them. ' +
  "The numbers hold only until the note is written again; after that, link words yourself with [[Title|words]] in note_write."

export const NOTE_SEARCH_DESCRIPTION =
  "Search your notes for a text in their titles, aliases, summaries and text (case and full-width/half-width do not matter, and no word boundary is needed). " +
  "Notes whose title or alias matches come first; each result gives the title, type and summary, and the matching lines."

export const NOTE_SEARCH_PARAMETERS = {
  query: "The text to look for.",
  type: "Only notes of this type.",
  limit: "Most notes returned (default 10, at most 50).",
} as const

export const MENTIONS_LEAD =
  "Notes that may be relevant to this message (read them with note_read if they help):"

const MEMORY_FLUSH_AHEAD: { readonly [K in MainMaintenance["kind"]]: string } = {
  compact:
    "This conversation will be compacted soon: its older part will be replaced by a summary, and details that are not in your notes will be lost.",
  rotate:
    "This conversation will end soon: a new Main session takes over without it, and it starts from your pinned notes and what it looks up in your notes.",
}

const MEMORY_FLUSH_SUMMARY: { readonly [K in MainMaintenance["kind"]]: string } = {
  compact: "Memory write-out before compaction",
  rotate: "Memory write-out before a new Main",
}

export function memoryFlushPrompt(maintenance: MainMaintenance): MainTurnPrompt {
  return {
    text: [
      MEMORY_FLUSH_AHEAD[maintenance.kind],
      "Before that, write down what you will still need later and have not written in your notes yet:",
      "- People, places, organizations, matters and things: in that thing's own note (note_write), as its current state.",
      "- What happened today: append it to today's daily note (note_write with action append).",
      "- What is in progress, upcoming plans and promises: in your pinned Now note.",
      "After you write, check the suggested links and link the ones you meant with note_link.",
      "When you note a fact from an email, a web page, a connector event or someone other than your owner, write where it came from.",
      "If there is nothing new to write, write nothing. Do not ask anyone anything now. Your reply goes nowhere; keep it to one short line.",
    ].join("\n"),
    summary: MEMORY_FLUSH_SUMMARY[maintenance.kind],
  }
}
