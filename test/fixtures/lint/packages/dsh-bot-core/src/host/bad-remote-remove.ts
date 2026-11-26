import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol"

export class Things extends TypertRemoteService {
  async remove(_id: string): Promise<void> {}
}
