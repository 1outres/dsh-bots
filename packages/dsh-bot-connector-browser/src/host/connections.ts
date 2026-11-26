export class BrowserConnections {
  private readonly opened = new Map<string, number>()
  private readonly unseen = new Set<string>()

  connected(botId: string): void {
    const count = (this.opened.get(botId) ?? 0) + 1
    this.opened.set(botId, count)
    if (count > 1) this.unseen.add(botId)
  }

  takeReconnected(botId: string): boolean {
    return this.unseen.delete(botId)
  }
}
