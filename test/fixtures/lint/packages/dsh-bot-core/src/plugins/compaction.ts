export function engine(ctx: { get(name: string): unknown }) {
  return ctx.get("compaction")
}
