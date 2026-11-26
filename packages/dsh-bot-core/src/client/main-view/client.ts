import type {
  MainTimelineCursor,
  MainTimelineFrame,
  MainTimelineImageData,
  MainTimelinePage,
} from "../../shared/main-view"
import type { Observable } from "../observable"
import type { BotMainViewRemote, RemoteMount } from "../remote"
import { mountedRemote, unwrap } from "../remote-feed"
import type { StreamHandle } from "../types"

/** The `botMainView` Remote for the browser: calls reject with the Host's message. */
export interface MainViewClient {
  readonly generation: Observable<object | undefined>
  watch(botId: string): Promise<() => StreamHandle<MainTimelineFrame>>
  page(botId: string, before: MainTimelineCursor): Promise<MainTimelinePage>
  image(botId: string, sessionId: string, attachmentId: string): Promise<MainTimelineImageData>
}

export function createMainViewClient(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
): MainViewClient {
  const face = async (): Promise<BotMainViewRemote> => (await mountedRemote(mount)).botMainView
  return {
    generation,
    async watch(botId) {
      const remote = await face()
      return () => remote.watch(botId)
    },
    page: async (botId, before) => unwrap(await (await face()).page(botId, before)),
    image: async (botId, sessionId, attachmentId) =>
      unwrap(await (await face()).image(botId, sessionId, attachmentId)),
  }
}
