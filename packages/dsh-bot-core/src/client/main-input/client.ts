import type {
  MainAppendResult,
  MainInputState,
  MainInputSubmission,
  MainSendResult,
  MainStageRequest,
  MainStageResult,
  MainStopResult,
} from "../../shared/main-input"
import type { Observable } from "../observable"
import type { BotMainInputRemote, RemoteMount } from "../remote"
import { mountedRemote, unwrap } from "../remote-feed"
import type { StreamHandle } from "../types"

export interface MainInputClient {
  readonly generation: Observable<object | undefined>
  watch(botId: string): Promise<() => StreamHandle<MainInputState>>
  stage(botId: string, request: MainStageRequest): Promise<MainStageResult>
  append(
    botId: string,
    attachmentId: string,
    offset: number,
    data: string,
  ): Promise<MainAppendResult>
  discard(botId: string, attachmentId: string): Promise<boolean>
  send(botId: string, submission: MainInputSubmission): Promise<MainSendResult>
  stop(botId: string): Promise<MainStopResult>
}

export function createMainInputClient(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
): MainInputClient {
  const face = async (): Promise<BotMainInputRemote> => (await mountedRemote(mount)).botMainInput
  return {
    generation,
    async watch(botId) {
      const remote = await face()
      return () => remote.watch(botId)
    },
    stage: async (botId, request) => unwrap(await (await face()).stage(botId, request)),
    append: async (botId, attachmentId, offset, data) =>
      unwrap(await (await face()).append(botId, attachmentId, offset, data)),
    discard: async (botId, attachmentId) =>
      unwrap(await (await face()).discard(botId, attachmentId)).discarded,
    send: async (botId, submission) => unwrap(await (await face()).send(botId, submission)),
    stop: async (botId) => unwrap(await (await face()).stop(botId)),
  }
}
