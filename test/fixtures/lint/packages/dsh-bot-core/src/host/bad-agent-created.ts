export function listen(events: { on(name: string, f: () => void): void }) {
  events.on("agent/created", () => {})
  events.on("agent/disposed", () => {})
}
