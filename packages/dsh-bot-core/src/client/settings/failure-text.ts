import type { Translate } from "../types"

export const failureText = (t: Translate, cause: unknown): string =>
  t("error.generic", { message: cause instanceof Error ? cause.message : String(cause) })
