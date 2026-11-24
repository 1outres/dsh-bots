import type { Translate } from "../types"

/** A failed save or step as the sections show it. */
export const failureText = (t: Translate, cause: unknown): string =>
  t("error.generic", { message: cause instanceof Error ? cause.message : String(cause) })
