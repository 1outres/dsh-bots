export function listen(events: { on(name: string, f: () => void): void }) {
  events.on("user-questions/request", () => {})
  events.on("approval/request", () => {})
  events.on("approval/decided", () => {})
}
