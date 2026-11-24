// bot-core's compaction row reads its realm's compaction by name.
export function engine(ctx: { get(name: string): unknown }) {
  return ctx.get("compaction")
}
