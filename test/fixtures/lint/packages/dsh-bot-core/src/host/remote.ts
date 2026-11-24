// The Remote entry may take a Context; removeBot is not "remove".
import type { Context } from "@deepseek-ai/cordis"
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"

const REGISTRY = Symbol("registry")

export class BotsRemote extends TypertRemoteService {
  [REGISTRY]: string

  constructor(ctx: Context) {
    super(ctx, "bots")
    this[REGISTRY] = "x"
  }

  async removeBot(): Promise<void> {}
}
