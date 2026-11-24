import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  distinctNames,
  inboxFolderName,
  MAX_FILE_NAME_BYTES,
  sanitizeFileName,
} from "../src/host/channels/inbox"
import {
  createShellInboxWriter,
  type EnvironmentWriteSubprocess,
} from "../src/host/channels/inbox-shell"

describe("inbox names", () => {
  it("keep one plain path segment", () => {
    expect(sanitizeFileName("report.pdf")).toBe("report.pdf")
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd")
    expect(sanitizeFileName("C:\\Users\\me\\note.txt")).toBe("note.txt")
    expect(sanitizeFileName(".bashrc")).toBe("bashrc")
    expect(sanitizeFileName("--rm -rf")).toBe("rm -rf")
    expect(sanitizeFileName("a\u0000b\nc\u202e.txt")).toBe("abc.txt")
    expect(sanitizeFileName("  写真   一覧.png ")).toBe("写真 一覧.png")
    expect(sanitizeFileName("..")).toBe("file")
    expect(sanitizeFileName("")).toBe("file")
  })

  it("cut long names to the byte limit, keeping the extension", () => {
    const name = sanitizeFileName(`${"あ".repeat(100)}.markdown`)
    expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(MAX_FILE_NAME_BYTES)
    expect(name.endsWith("あ.markdown")).toBe(true)
  })

  it("make names distinct and name the folder after the message", () => {
    expect(distinctNames(["a.txt", "a.txt", "b", "a.txt", "b"])).toEqual([
      "a.txt",
      "a (2).txt",
      "b",
      "a (3).txt",
      "b (2)",
    ])
    expect(inboxFolderName(Date.UTC(2026, 0, 2, 3, 4, 5), "discord")).toBe(
      "20260102T030405Z-discord",
    )
  })
})

/** dsh-subprocess, as the bot's environment would run it, on this machine. */
const localSubprocess: EnvironmentWriteSubprocess = {
  spawn(spec) {
    const child = spawn(spec.argv[0] as string, spec.argv.slice(1), {
      cwd: spec.cwd,
      stdio: [spec.stdio.stdin === "pipe" ? "pipe" : "ignore", "pipe", "pipe"],
      signal: spec.signal,
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    return {
      stdin: child.stdin ?? undefined,
      collected: {
        stdout: { readFrom: () => ({ text: stdout }) },
        stderr: { readFrom: () => ({ text: stderr }) },
      },
      done: new Promise((resolve) =>
        child.on("close", (exitCode, signal) => resolve({ exitCode, signal })),
      ),
    }
  },
}

describe("shell inbox writer", () => {
  let root = ""
  afterEach(async () => {
    if (root !== "") await rm(root, { recursive: true, force: true })
  })

  it("creates a new folder each time and writes binary files, refusing to replace one", async () => {
    root = await mkdtemp(join(tmpdir(), "inbox-"))
    const writer = createShellInboxWriter(localSubprocess, root)
    const signal = new AbortController().signal
    const inbox = join(root, ".inbox")
    const first = await writer.createFolder(inbox, "m", signal)
    const second = await writer.createFolder(inbox, "m", signal)
    expect([first, second]).toEqual([join(inbox, "m"), join(inbox, "m-2")])
    const bytes = new Uint8Array([0, 255, 10, 13, 0x1b, 7])
    const path = await writer.writeFile(first, "a b.bin", bytes, signal)
    expect(path).toBe(join(first, "a b.bin"))
    expect(new Uint8Array(await readFile(path))).toEqual(bytes)
    await expect(writer.writeFile(first, "a b.bin", bytes, signal)).rejects.toThrow(
      "already exists",
    )
    await symlink("/etc/passwd", join(first, "link"))
    await expect(writer.writeFile(first, "link", bytes, signal)).rejects.toThrow("already exists")
  })

  it("reports a folder it cannot create", async () => {
    root = await mkdtemp(join(tmpdir(), "inbox-"))
    await writeFile(join(root, "file"), "x")
    const writer = createShellInboxWriter(localSubprocess, root)
    await expect(
      writer.createFolder(join(root, "file"), "m", new AbortController().signal),
    ).rejects.toThrow(/exit 1/)
  })
})
