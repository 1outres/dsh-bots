import type {
  MainBotReply,
  MainMessageAuthor,
  MainPersonMessage,
  MainPresentedFiles,
  MainTimelineItem,
  MainTurnOutcome,
} from "../../shared/main-view"

export type TimelineRow =
  | { readonly kind: "day"; readonly key: string; readonly day: string }
  | {
      readonly kind: "person"
      readonly key: string
      readonly author: MainMessageAuthor
      readonly at: number
      readonly messages: readonly MainPersonMessage[]
    }
  | {
      readonly kind: "bot"
      readonly key: string
      readonly at: number
      readonly entries: readonly (MainBotReply | MainPresentedFiles)[]
    }
  | { readonly kind: "turn"; readonly key: string; readonly item: MainTurnOutcome }

export const GROUP_GAP_MS = 5 * 60_000

export function authorKey(author: MainMessageAuthor): string {
  return author.kind === "web" ? "web" : `${author.channel}\u0000${author.handle}`
}

const near = (entries: readonly MainTimelineItem[], at: number) => {
  const last = entries.at(-1)
  return last !== undefined && at - last.at <= GROUP_GAP_MS
}

export function timelineRows(
  items: readonly MainTimelineItem[],
  dayOf: (at: number) => string,
): readonly TimelineRow[] {
  const rows: TimelineRow[] = []
  let day: string | undefined
  for (const item of items) {
    const itemDay = dayOf(item.at)
    if (itemDay !== day) {
      day = itemDay
      rows.push({ kind: "day", key: `day:${itemDay}`, day: itemDay })
    }
    const last = rows.at(-1)
    switch (item.kind) {
      case "person":
        if (
          last?.kind === "person" &&
          authorKey(last.author) === authorKey(item.author) &&
          near(last.messages, item.at)
        ) {
          rows[rows.length - 1] = { ...last, messages: [...last.messages, item] }
        } else {
          rows.push({
            kind: "person",
            key: item.id,
            author: item.author,
            at: item.at,
            messages: [item],
          })
        }
        break
      case "reply":
      case "presented":
        if (last?.kind === "bot" && near(last.entries, item.at)) {
          rows[rows.length - 1] = { ...last, entries: [...last.entries, item] }
        } else {
          rows.push({ kind: "bot", key: item.id, at: item.at, entries: [item] })
        }
        break
      case "turn":
        rows.push({ kind: "turn", key: item.id, item })
        break
    }
  }
  return rows
}
