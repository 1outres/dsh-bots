// bot-core's files row reads its group's isolated services by name.
export function isolated(ctx: { get(name: string): unknown }) {
  return ctx.get("fs")
}
