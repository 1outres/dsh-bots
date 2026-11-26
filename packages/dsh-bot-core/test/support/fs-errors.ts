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

export const localFsError = (code: string, message = code) => new FsError(message, code)

export const sshFsError = (code: string, options: { adopted: boolean; message?: string }) => {
  const message = options.message ?? `helper: ${code}`
  return new FsError(message, options.adopted ? code : "FS_IO_ERROR", {
    cause: new RemoteOperationError(message, code),
  })
}

export const sshTransportError = (message: string) =>
  new FsError(message, "FS_IO_ERROR", { cause: new Error(message) })
