export function botOf(ctx: { get(name: string): unknown }) {
  return ctx.get("bot")
}
export function keys(ctx: { inject(names: string[], apply: () => void): void }) {
  ctx.inject(["credentials"], () => {})
}
