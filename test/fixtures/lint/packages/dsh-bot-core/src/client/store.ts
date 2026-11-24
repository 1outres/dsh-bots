// The browser reads its mounted Remote proxy by name.
export function remoteOf(ctx: { get(name: string): unknown }) {
  return ctx.get(`remote.bots`)
}
