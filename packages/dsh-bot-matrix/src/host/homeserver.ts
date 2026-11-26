import type { BotChannelText } from "@1outres/dsh-bot-core"
import { localpartOf, serverNameOf } from "./ids"
import { isMatrixError, type MatrixApi, type OpenMatrixApi } from "./matrix"
import { type MatrixServer, serverOf } from "./servers"
import type { MatrixShared } from "./shared-fields"

export interface Homeserver {
  readonly api: MatrixApi
  readonly server: MatrixServer
  readonly prefix: string
}

export function homeserverOf(open: OpenMatrixApi, shared: MatrixShared): Homeserver {
  return {
    api: open(shared.homeserver, shared.asToken),
    server: serverOf(shared.server),
    prefix: shared.prefix,
  }
}

export interface ServiceIdentity {
  readonly sender: string
  readonly serverName: string
}

export class HomeserverRefusal extends Error {
  override readonly name = "HomeserverRefusal"
  constructor(readonly reason: BotChannelText) {
    super(reason.en)
  }
}

export const TOKEN_REFUSED: BotChannelText = {
  en: "The homeserver refused the application service token: it does not match the registration file.",
  ja: "homeserver が Application Service のトークンを受け付けませんでした。登録ファイルの as_token と合っていません。",
}

export async function serviceIdentity(
  home: Homeserver,
  signal: AbortSignal,
): Promise<ServiceIdentity> {
  let sender: string
  try {
    sender = await home.api.whoami(signal)
  } catch (error) {
    if (isMatrixError(error, "token")) throw new HomeserverRefusal(TOKEN_REFUSED)
    throw error
  }
  if (localpartOf(sender) !== home.prefix) {
    throw new HomeserverRefusal({
      en: `The registration file's sender_localpart is "${localpartOf(sender)}", not the prefix "${home.prefix}". Make them the same.`,
      ja: `登録ファイルの sender_localpart は「${localpartOf(sender)}」で、接頭辞「${home.prefix}」と違います。同じにしてください。`,
    })
  }
  return { sender, serverName: serverNameOf(sender) }
}
