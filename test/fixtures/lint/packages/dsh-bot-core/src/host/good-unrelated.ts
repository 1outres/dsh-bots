export function forget(masks: Map<string, number>, listeners: Set<() => void>, now: () => number) {
  masks.delete("a")
  listeners.delete(() => {})
  return now()
}
export class Queue {
  #items: string[] = []
  remove(): string | undefined {
    return this.#items.pop()
  }
}
export const label = (id: string) => `robot-${id}` + "bot"
