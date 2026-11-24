/**
 * How many times each bot's connection to Playwright MCP was opened in this
 * process, so that the first result on a new connection says what it lost
 * (element refs of earlier snapshots). State only.
 */
export class BrowserConnections {
  private readonly opened = new Map<string, number>()
  private readonly unseen = new Set<string>()

  /** A connection opened; every one after the first is a reconnection. */
  connected(botId: string): void {
    const count = (this.opened.get(botId) ?? 0) + 1
    this.opened.set(botId, count)
    if (count > 1) this.unseen.add(botId)
  }

  /** Whether the next result is the first since a reconnection (it then is not any more). */
  takeReconnected(botId: string): boolean {
    return this.unseen.delete(botId)
  }
}
