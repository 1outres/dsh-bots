export function botOf(ctx: { get(name: string): unknown }) {
  return ctx.get("bot")
}
