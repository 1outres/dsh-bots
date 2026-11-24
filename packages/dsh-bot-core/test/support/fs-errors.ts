/**
 * Errors shaped exactly as a bot's file system delivers them (pinned against
 * the real dsh-fs-ssh by dsh-bot-vm/test/fs-ssh-errors.test.ts).
 */

class FsError extends Error {
  constructor(
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "FsError"
  }
}

class RemoteOperationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = "RemoteOperationError"
  }
}

/** A local dsh-fs provider's failure. */
export const localFsError = (code: string, message = code) => new FsError(message, code)

/**
 * dsh-fs-ssh's failure for the helper's error `code`: the code adopted when it
 * recognises dsh-ssh's class (`adopted`), `FS_IO_ERROR` otherwise.
 */
export const sshFsError = (code: string, options: { adopted: boolean; message?: string }) => {
  const message = options.message ?? `helper: ${code}`
  return new FsError(message, options.adopted ? code : "FS_IO_ERROR", {
    cause: new RemoteOperationError(message, code),
  })
}

/** dsh-fs-ssh's failure when the VM cannot answer at all. */
export const sshTransportError = (message: string) =>
  new FsError(message, "FS_IO_ERROR", { cause: new Error(message) })
