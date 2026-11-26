import { type Context, Service } from "@deepseek-ai/cordis"

export class Counter extends Service {
  #count = 0

  constructor(context: unknown) {
    super(context as never, "counter")
  }

  next(): number {
    this.#count += 1
    return this.#count
  }
}
export type Unused = Context
