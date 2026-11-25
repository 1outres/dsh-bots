// Compliant: bot-vm reads the bot service by name in its composition root.
export function botOf(ctx: { get(name: string): unknown }) {
  return ctx.get("bot")
}
// Compliant: bot-vm's composition root keeps the paired VM host's key in DSH's credentials.
export function keys(ctx: { inject(names: string[], apply: () => void): void }) {
  ctx.inject(["credentials"], () => {})
}
