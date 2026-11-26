export function lookup(ctx: { get(name: string): unknown }) {
  return ctx.get("bot")
}
export const secrets = ["credentials"]
