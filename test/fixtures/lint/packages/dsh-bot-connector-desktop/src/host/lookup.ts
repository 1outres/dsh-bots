export function lookup(ctx: { get(name: string): unknown }) {
  return ctx.get("bot") // rule: 8
}
