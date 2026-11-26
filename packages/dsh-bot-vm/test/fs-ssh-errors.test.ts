import { Context } from "@deepseek-ai/cordis"
import { RemoteOperationError } from "@deepseek-ai/dsh-ssh/protocol"
import { describe, expect, it } from "vitest"

const FS_SSH: string = "@deepseek-ai/dsh-fs-ssh"
const { default: SshFileSystem } = (await import(FS_SSH)) as {
  default: new (ctx: Context) => { readText(target: { targetKey: string }): Promise<string> }
}

class ForeignRemoteOperationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = "RemoteOperationError"
  }
}

async function delivered(thrown: Error): Promise<unknown> {
  const ctx = new Context()
  ctx.provide("ssh", {
    request: async () => {
      throw thrown
    },
  })
  ctx.provide("sandboxPolicy", { defaultMode: "read-only" })
  const fs = new SshFileSystem(ctx)
  return fs.readText({ targetKey: "/home/bot/workspace/data.bin" }).then(
    () => expect.unreachable(),
    (error: unknown) => error,
  )
}

const shape = (error: unknown) => {
  const { name, code, message, cause } = error as {
    name: string
    code: string
    message: string
    cause: { name: string; code?: string }
  }
  return { name, code, message, cause: { name: cause.name, code: cause.code } }
}

const MESSAGE = 'cannot read "/home/bot/workspace/data.bin": binary file'

describe("dsh-fs-ssh error contract", () => {
  it("adopts the helper's FsError code when it recognises dsh-ssh's RemoteOperationError", async () => {
    expect(shape(await delivered(new RemoteOperationError(MESSAGE, "FS_NOT_TEXT")))).toEqual({
      name: "FsError",
      code: "FS_NOT_TEXT",
      message: MESSAGE,
      cause: { name: "RemoteOperationError", code: "FS_NOT_TEXT" },
    })
  })

  it("reports FS_IO_ERROR, keeping the helper's code on the cause, for another copy of dsh-ssh", async () => {
    expect(shape(await delivered(new ForeignRemoteOperationError(MESSAGE, "FS_NOT_TEXT")))).toEqual(
      {
        name: "FsError",
        code: "FS_IO_ERROR",
        message: MESSAGE,
        cause: { name: "RemoteOperationError", code: "FS_NOT_TEXT" },
      },
    )
  })

  it("reports FS_IO_ERROR for a helper code outside dsh-fs' vocabulary, keeping it on the cause", async () => {
    expect(shape(await delivered(new RemoteOperationError("open failed", "ENOENT")))).toEqual({
      name: "FsError",
      code: "FS_IO_ERROR",
      message: "open failed",
      cause: { name: "RemoteOperationError", code: "ENOENT" },
    })
  })

  it("reports FS_IO_ERROR with the transport's error as cause when the VM cannot answer", async () => {
    expect(
      shape(await delivered(new Error("cannot reach the bot VM over SSH (x): timeout"))),
    ).toEqual({
      name: "FsError",
      code: "FS_IO_ERROR",
      message: "cannot reach the bot VM over SSH (x): timeout",
      cause: { name: "Error", code: undefined },
    })
  })
})
