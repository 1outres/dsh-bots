import { type Context, Service } from "@deepseek-ai/cordis"

export class Counter extends Service {
  // The rule reports the first #private member of each class.
  #count = 0 // rule: 20

  constructor(context: unknown) {
    super(context as never, "counter")
  }

  next(): number {
    this.#count += 1
    return this.#count
  }
}
export type Unused = Context
