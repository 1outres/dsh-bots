export function listen(events: { on(name: string, f: () => void): void }) {
  events.on("user-questions/request", () => {}) // rule: 36
  events.on("approval/request", () => {}) // rule: 36
  events.on("approval/decided", () => {})
}
