export function answer(events: { on(name: string, f: () => void): void }) {
  events.on("approval/request", () => {})
}
