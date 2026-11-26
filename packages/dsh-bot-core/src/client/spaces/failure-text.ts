import type { MessageKey } from "../i18n"
import type { Translate } from "../types"
import { type SpaceRequestCode, SpaceRequestError, type SpacesFailure } from "./feed"
import { SpaceTabBlockedError } from "./flows"

const REFUSED: { readonly [Code in SpaceRequestCode]: MessageKey } = {
  "bot-space/not-found": "spaces.error.notFound",
  "bot-space/invalid-base-url": "spaces.error.invalidBaseUrl",
  "bot-space/not-owner": "spaces.error.notOwner",
  "gateway/bad-request": "spaces.error.badRequest",
}

export function spaceFailureText(t: Translate, failure: SpacesFailure): string {
  switch (failure.kind) {
    case "refused":
      return t(REFUSED[failure.code], { message: failure.message })
    case "connection":
      return t("spaces.error.connection", { message: failure.message })
    case "mount":
      return t("spaces.error.mount", { message: failure.message })
    case "protocol":
      return t("spaces.error.protocol", { message: failure.message })
  }
}

export function spaceErrorText(t: Translate, error: unknown): string {
  if (error instanceof SpaceRequestError) return spaceFailureText(t, error.failure)
  if (error instanceof SpaceTabBlockedError) return t("spaces.error.tabBlocked")
  return t("error.generic", { message: error instanceof Error ? error.message : String(error) })
}
