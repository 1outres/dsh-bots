export function remoteOf(ctx: { get(name: string): unknown }) {
  return ctx.get(`remote.bots`)
}
