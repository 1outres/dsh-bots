// Any other plugin module still goes through botOf(ctx).
export function lookup(ctx: { get(name: string): unknown }) {
  return ctx.get("fs") // rule: 8
}
