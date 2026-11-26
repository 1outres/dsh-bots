import { Avatar } from "../Avatar"
import { useObservable } from "../hooks"
import { IconSpace } from "../icons"
import type { Observable } from "../observable"
import { type BotsState, snapshotOf } from "../session-classification"

export interface SpacePanelIconFace {
  readonly bots: Observable<BotsState>
  readonly botId: string
}

export function SpacePanelIcon(props: SpacePanelIconFace & { readonly size: number }) {
  const bot = snapshotOf(useObservable(props.bots))?.bots.find((item) => item.id === props.botId)
  if (bot === undefined) return <IconSpace size={props.size} />
  return <Avatar avatar={bot.avatar} size={props.size} />
}
