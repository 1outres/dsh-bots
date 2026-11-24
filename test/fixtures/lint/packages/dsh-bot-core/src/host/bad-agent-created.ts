export function listen(events: { on(name: string, f: () => void): void }) {
  events.on("agent/created", () => {}) // rule: 4
  events.on("agent/disposed", () => {})
}
