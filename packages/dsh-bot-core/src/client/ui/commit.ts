/** How saving a value ended: a failure carries its message in the user's language. */
export type CommitResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

export const COMMITTED: CommitResult = { ok: true }

/** Run `save`, a rejection becoming a failed result with `describe`'s message. */
export async function commitWith(
  save: () => Promise<unknown>,
  describe: (cause: unknown) => string,
): Promise<CommitResult> {
  try {
    await save()
    return COMMITTED
  } catch (cause) {
    return { ok: false, message: describe(cause) }
  }
}
