export type CommitResult = { readonly ok: true } | { readonly ok: false; readonly message: string }

export const COMMITTED: CommitResult = { ok: true }

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
