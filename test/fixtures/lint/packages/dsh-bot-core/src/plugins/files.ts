export function isolated(ctx: { get(name: string): unknown }) {
  return ctx.get("fs")
}
