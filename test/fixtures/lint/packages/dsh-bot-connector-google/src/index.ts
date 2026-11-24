// Compliant: bot-vm reads the bot service by name in its composition root.
export function botOf(ctx: { get(name: string): unknown }) {
  return ctx.get("bot")
}
