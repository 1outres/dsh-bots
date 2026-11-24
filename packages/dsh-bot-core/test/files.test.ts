import { posix } from "node:path"
import { describe, expect, it } from "vitest"
import {
  type BotFilesLimits,
  createBotFiles,
  createEnvironmentFilesKeeper,
  DEFAULT_FILES_LIMITS,
  type EnvironmentFileSystem,
  type EnvironmentOutput,
  type EnvironmentProcess,
  type EnvironmentSubprocess,
} from "../src/host/files"
import { localFsError as fsError, sshFsError, sshTransportError } from "./support/fs-errors"

const WORKSPACE = "/home/bot/workspace"

type Node =
  | { readonly type: "file"; readonly data: Uint8Array }
  | { readonly type: "directory" }
  | { readonly type: "symlink"; readonly to: string }
  | { readonly type: "other" }

interface Target {
  readonly key: string
}

const text = (value: string) => new TextEncoder().encode(value)

/**
 * An in-memory POSIX file system shaped like dsh-fs: symlinks resolved by
 * `resolve`/`stat`, kept by `lstat`; text streamed in small chunks so a
 * page is cut across chunk boundaries.
 */
function fakeFs(entries: Record<string, Node>) {
  const nodes = new Map<string, Node>([["/", { type: "directory" }], ...Object.entries(entries)])
  // Every ancestor is a directory.
  for (const path of [...nodes.keys()]) {
    for (let dir = posix.dirname(path); dir !== "/"; dir = posix.dirname(dir)) {
      if (!nodes.has(dir)) nodes.set(dir, { type: "directory" })
    }
  }
  const calls: string[] = []
  const follow = (path: string): string => {
    let current = path
    for (let hops = 0; hops < 10; hops++) {
      const node = nodes.get(current)
      if (node?.type !== "symlink") return current
      current = posix.resolve(posix.dirname(current), node.to)
    }
    return current
  }
  const info = (node: Node) => ({
    version: "v1",
    type: node.type === "symlink" ? ("other" as const) : node.type,
    ...(node.type === "file" ? { size: node.data.length } : {}),
  })
  const fileOf = (target: Target): Uint8Array => {
    const node = nodes.get(target.key)
    if (node === undefined) throw fsError("FS_NOT_FOUND")
    if (node.type !== "file") throw fsError("FS_NOT_REGULAR_FILE")
    return node.data
  }
  const fs: EnvironmentFileSystem = {
    async resolve(path, options) {
      calls.push(`resolve ${path}`)
      return { key: follow(posix.resolve(options?.cwd ?? "/", path)) }
    },
    processPath: (target) => (target as Target).key,
    contains(parent, child) {
      const relative = posix.relative((parent as Target).key, (child as Target).key)
      return relative === "" || (!relative.startsWith("..") && !posix.isAbsolute(relative))
    },
    async stat(target) {
      const node = nodes.get((target as Target).key)
      return node === undefined ? undefined : info(node)
    },
    async lstat(path, options) {
      calls.push(`lstat ${path}`)
      const node = nodes.get(posix.resolve(options?.cwd ?? "/", path))
      if (node === undefined) return undefined
      return {
        version: "v1",
        type: node.type,
        ...(node.type === "file" ? { size: node.data.length } : {}),
      }
    },
    async streamText(target) {
      const data = fileOf(target as Target)
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(data)
      return (async function* () {
        for (let index = 0; index < decoded.length; index += 3)
          yield decoded.slice(index, index + 3)
      })()
    },
    async readBytes(target, _signal, maxBytes) {
      const data = fileOf(target as Target)
      if (data.length > maxBytes) throw fsError("FS_TOO_LARGE")
      return data
    },
    async readByteRange(target, range) {
      return fileOf(target as Target).slice(range.offset, range.offset + range.length)
    },
    async listDir(target) {
      const dir = (target as Target).key
      return [...nodes.entries()]
        .filter(([path]) => path !== "/" && posix.dirname(path) === dir)
        .map(([path, node]) => {
          const resolved = nodes.get(follow(path)) ?? node
          return {
            name: posix.basename(path),
            type: resolved.type === "symlink" ? ("other" as const) : resolved.type,
            ...(resolved.type === "file" ? { size: resolved.data.length } : {}),
          }
        })
        .sort((a, b) => (a.name < b.name ? -1 : 1))
    },
  }
  return { fs, calls, nodes }
}

/** A piped stdout yielding `chunks`; `destroy` ends it as a destroyed Readable would. */
function output(chunks: AsyncGenerator<string, void>): EnvironmentOutput {
  return Object.assign(chunks, {
    setEncoding() {},
    destroy() {
      void chunks.return()
    },
  })
}

/** A subprocess whose one run prints `files` NUL-separated and exits with `exitCode`. */
function fakeSubprocess(
  files: string[],
  exitCode = 0,
  waitForExit: () => Promise<boolean> = async () => true,
) {
  const spawned: { argv: readonly string[]; cwd: string }[] = []
  let terminated = 0
  const subprocess: EnvironmentSubprocess = {
    spawn(spec) {
      spawned.push({ argv: spec.argv, cwd: spec.cwd })
      const handle: EnvironmentProcess = {
        stdout: output(
          (async function* () {
            // Records split across chunks.
            const listing = files.map((file) => `${file}\0`).join("")
            for (let index = 0; index < listing.length; index += 5)
              yield listing.slice(index, index + 5)
          })(),
        ),
        done: Promise.resolve({ exitCode, signal: null }),
        collected: { stderr: { readFrom: () => ({ text: exitCode > 2 ? "boom" : "" }) } },
        terminate() {
          terminated += 1
        },
        waitForExit,
      }
      return handle
    },
    async resolveExecutable(command) {
      return `/usr/bin/${command}`
    },
  }
  return { subprocess, spawned, terminated: () => terminated }
}

function limits(overrides: Partial<BotFilesLimits> = {}): BotFilesLimits {
  return {
    ...DEFAULT_FILES_LIMITS,
    ...overrides,
    search: { ...DEFAULT_FILES_LIMITS.search, ...overrides.search },
  }
}

const tree = (): Record<string, Node> => ({
  [`${WORKSPACE}/notes.md`]: { type: "file", data: text("one\ntwo\nthree\n") },
  [`${WORKSPACE}/src/app.ts`]: { type: "file", data: text("export {}\n") },
  [`${WORKSPACE}/src/lib/util.ts`]: { type: "file", data: text("x") },
  [`${WORKSPACE}/image.bin`]: { type: "file", data: new Uint8Array([0, 1, 2, 3, 4, 5]) },
  [`${WORKSPACE}/link.md`]: { type: "symlink", to: "notes.md" },
  [`${WORKSPACE}/outside`]: { type: "symlink", to: "/etc" },
  [`${WORKSPACE}/inside`]: { type: "symlink", to: "src" },
  "/etc/hostname": { type: "file", data: text("vm\n") },
})

function setup(
  options: {
    entries?: Record<string, Node>
    limits?: Partial<BotFilesLimits>
    subprocess?: EnvironmentSubprocess | undefined
    environment?: boolean
    deadline?: (ms: number) => AbortSignal
  } = {},
) {
  const fake = fakeFs(options.entries ?? tree())
  /** session id -> bot id, as the registry records it (stored bots only). */
  const sessions = new Map([
    ["s-main", "b1"],
    ["s-other", "b1"],
  ])
  const asked: string[] = []
  const warnings: string[] = []
  const files = createBotFiles({
    botOfSession: (sessionId) => sessions.get(sessionId),
    environmentOf(botId) {
      asked.push(botId)
      if (options.environment === false) return undefined
      return { fs: fake.fs, subprocess: options.subprocess }
    },
    workspace: () => WORKSPACE,
    limits: limits(options.limits),
    deadline: options.deadline ?? (() => new AbortController().signal),
    warn: (message) => warnings.push(message),
  })
  return { files, fake, sessions, asked, warnings }
}

/** The rejection's RemoteError code and details. */
async function failure(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    const { code, details } = error as { code: string; details: unknown }
    return { code, details }
  }
  throw new Error("expected a rejection")
}

describe("botFiles: authorization", () => {
  it("answers only sessions bot-core recorded as a stored bot's, before touching any file system", async () => {
    const { files, asked, fake } = setup()
    for (const call of [
      files.stat("s-unknown", "notes.md"),
      files.read("s-unknown", "notes.md"),
      files.readBytes("s-unknown", "notes.md", {}),
      files.list("s-unknown", ""),
      files.search("s-unknown", { query: "a" }),
    ]) {
      expect(await failure(call)).toEqual({
        code: "bot-file/not-bot-session",
        details: { sessionId: "s-unknown" },
      })
    }
    expect(asked).toEqual([])
    expect(fake.calls).toEqual([])
    expect((await failure(files.stat("", "notes.md"))).code).toBe("gateway/bad-request")
  })

  it("fails closed without the bot's environment services", async () => {
    const { files, asked } = setup({ environment: false })
    expect(await failure(files.read("s-main", "notes.md"))).toEqual({
      code: "bot-file/unavailable",
      details: { sessionId: "s-main" },
    })
    expect(asked).toEqual(["b1"])
  })

  it("reports an environment that cannot answer as unavailable, warning with its cause", async () => {
    const { files, fake, warnings } = setup()
    fake.fs.lstat = async () => {
      throw new Error("cannot reach the bot VM over SSH (dsh-bot-b1): timeout", {
        cause: new Error("handshake timed out"),
      })
    }
    const result = await failure(files.stat("s-main", "notes.md"))
    expect(result.code).toBe("bot-file/unavailable")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('bot "b1"')
    expect(warnings[0]).toContain("Error: cannot reach the bot VM over SSH")
    expect(warnings[0]).toContain("<- Error: handshake timed out")
  })

  it("maps the environment's permission refusal, without a warning", async () => {
    const { files, fake, warnings } = setup()
    fake.fs.lstat = async () => {
      throw fsError("FS_PERMISSION_DENIED")
    }
    expect((await failure(files.stat("s-main", "/root/x"))).code).toBe("bot-file/permission-denied")
    expect(warnings).toEqual([])
  })
})

describe("botFiles: environment failures as dsh-fs-ssh delivers them", () => {
  const binary = 'cannot read "/home/bot/workspace/data.bin": binary file'

  it.each([true, false])(
    "reads a binary file as not-text (code adopted by dsh-fs-ssh: %s)",
    async (adopted) => {
      const { files, fake } = setup({
        entries: { [`${WORKSPACE}/data.bin`]: { type: "file", data: text("x") } },
      })
      fake.fs.streamText = async () => {
        throw sshFsError("FS_NOT_TEXT", { adopted, message: binary })
      }
      expect(await failure(files.read("s-main", "data.bin"))).toEqual({
        code: "bot-file/not-text",
        details: { path: "data.bin" },
      })
    },
  )

  it.each([
    ["FS_NOT_FOUND", { code: "bot-file/not-found", details: { path: "notes.md" } }],
    ["ENOENT", { code: "bot-file/not-found", details: { path: "notes.md" } }],
    ["ENOTDIR", { code: "bot-file/not-found", details: { path: "notes.md" } }],
    ["FS_PERMISSION_DENIED", { code: "bot-file/permission-denied", details: { path: "notes.md" } }],
    ["FS_SANDBOX_DENIED", { code: "bot-file/permission-denied", details: { path: "notes.md" } }],
    ["EACCES", { code: "bot-file/permission-denied", details: { path: "notes.md" } }],
    ["EPERM", { code: "bot-file/permission-denied", details: { path: "notes.md" } }],
    [
      "FS_NOT_REGULAR_FILE",
      { code: "bot-file/not-regular-file", details: { path: "notes.md", kind: "other" } },
    ],
    ["EISDIR", { code: "bot-file/not-regular-file", details: { path: "notes.md", kind: "other" } }],
    ["FS_NOT_TEXT", { code: "bot-file/not-text", details: { path: "notes.md" } }],
    ["FS_TOO_LARGE", { code: "bot-file/too-large", details: { path: "notes.md", limit: 64 } }],
  ])("maps the helper's %s over SSH, recognised or not", async (code, expected) => {
    for (const adopted of [true, false]) {
      const { files, fake } = setup({ limits: { maxBytes: 64 } })
      fake.fs.streamText = async () => {
        throw sshFsError(code, { adopted })
      }
      expect(await failure(files.read("s-main", "notes.md"))).toEqual(expected)
    }
  })

  it("maps a refused lstat, listing and stat of the workspace", async () => {
    const { files, fake } = setup({ subprocess: fakeSubprocess([]).subprocess })
    fake.fs.lstat = async () => {
      throw sshFsError("FS_PERMISSION_DENIED", { adopted: false })
    }
    expect(await failure(files.stat("s-main", "/root/x"))).toEqual({
      code: "bot-file/permission-denied",
      details: { path: "/root/x" },
    })
    const listing = setup()
    listing.fake.fs.listDir = async () => {
      throw sshFsError("FS_NOT_DIRECTORY", { adopted: false })
    }
    expect(await failure(listing.files.list("s-main", "src"))).toEqual({
      code: "bot-file/not-directory",
      details: { path: "src", kind: "other" },
    })
    fake.fs.stat = async () => {
      throw sshFsError("ENOENT", { adopted: false })
    }
    expect(await failure(files.search("s-main", { query: "a" }))).toEqual({
      code: "bot-file/not-found",
      details: { path: WORKSPACE },
    })
  })

  it("maps the helper's FS_TOO_LARGE on a complete read to the full-file cap", async () => {
    const { files, fake } = setup({ limits: { maxFileBytes: 1024 } })
    fake.fs.readBytes = async () => {
      throw sshFsError("FS_TOO_LARGE", { adopted: false })
    }
    expect(await failure(files.readBytes("s-main", "image.bin", {}))).toEqual({
      code: "bot-file/too-large",
      details: { path: "image.bin", limit: 1024 },
    })
  })

  it("reports a too-large failure of a call without a byte cap as unavailable, saying why", async () => {
    const { files, fake, warnings } = setup()
    fake.fs.lstat = async () => {
      throw sshFsError("FS_TOO_LARGE", { adopted: true })
    }
    const promise = files.stat("s-main", "notes.md")
    await expect(promise).rejects.toThrow("a size cap this call does not enforce")
    expect(await failure(promise)).toEqual({
      code: "bot-file/unavailable",
      details: { sessionId: "s-main" },
    })
    expect(warnings).toHaveLength(1)
  })

  it("reports a VM that cannot answer, and the helper's own I/O failure, as unavailable", async () => {
    for (const error of [
      sshTransportError("cannot reach the bot VM over SSH (dsh-bot-b1): timeout"),
      sshFsError("FS_IO_ERROR", { adopted: true }),
      sshFsError("SUBPROCESS_EXECUTABLE_NOT_FOUND", { adopted: false }),
    ]) {
      const { files, fake } = setup()
      fake.fs.streamText = async () => {
        throw error
      }
      expect(await failure(files.read("s-main", "notes.md"))).toEqual({
        code: "bot-file/unavailable",
        details: { sessionId: "s-main" },
      })
    }
  })

  it("passes the caller's abort through as is, and reports another FS_ABORTED as unavailable", async () => {
    const { files, fake } = setup()
    const controller = new AbortController()
    const aborted = sshFsError("FS_ABORTED", { adopted: false })
    fake.fs.streamText = async () => {
      controller.abort(new Error("caller left"))
      throw aborted
    }
    await expect(files.read("s-main", "notes.md", undefined, controller.signal)).rejects.toBe(
      aborted,
    )
    fake.fs.streamText = async () => {
      throw aborted
    }
    expect((await failure(files.read("s-main", "notes.md"))).code).toBe("bot-file/unavailable")
  })
})

describe("botFiles: stat and read", () => {
  it("stats a file relative to the workspace or absolute, outside the workspace too", async () => {
    const { files } = setup()
    expect(await files.stat("s-main", "notes.md")).toEqual({
      absolutePath: `${WORKSPACE}/notes.md`,
      version: "v1",
      bytes: 14,
    })
    expect((await files.stat("s-main", "/etc/hostname")).absolutePath).toBe("/etc/hostname")
  })

  it("refuses reads outside the workspace when confineReads is set", async () => {
    const { files } = setup({ limits: { confineReads: true } })
    expect(await failure(files.read("s-main", "/etc/hostname"))).toEqual({
      code: "bot-file/outside-workspace",
      details: { path: "/etc/hostname" },
    })
    expect((await files.read("s-main", "notes.md")).lines).toBe(3)
  })

  it("pages lines like workspaceFiles", async () => {
    const { files } = setup()
    expect(await files.read("s-main", "notes.md")).toMatchObject({
      offset: 1,
      text: "one\ntwo\nthree",
      lines: 3,
      eof: true,
    })
    expect(await files.read("s-main", "notes.md", { offset: 2, limit: 1 })).toMatchObject({
      offset: 2,
      text: "two",
      lines: 1,
      eof: false,
    })
    expect(await files.read("s-main", "notes.md", { offset: 9 })).toMatchObject({
      text: "",
      lines: 0,
      eof: true,
    })
  })

  it("refuses pages above the caps, bad ranges, and binary or non-regular files", async () => {
    const { files } = setup({ limits: { maxLines: 2, maxBytes: 5 } })
    expect((await failure(files.read("s-main", "notes.md", { limit: 3 }))).code).toBe(
      "gateway/bad-request",
    )
    expect((await failure(files.read("s-main", "notes.md", { offset: 0 }))).code).toBe(
      "gateway/bad-request",
    )
    expect(await failure(files.read("s-main", "notes.md"))).toEqual({
      code: "bot-file/too-large",
      details: { path: "notes.md", limit: 5 },
    })
    expect((await failure(setup().files.read("s-main", "image.bin"))).code).toBe(
      "bot-file/not-text",
    )
    expect(await failure(files.read("s-main", "link.md"))).toEqual({
      code: "bot-file/not-regular-file",
      details: { path: "link.md", kind: "symlink" },
    })
    expect(await failure(files.read("s-main", "src"))).toEqual({
      code: "bot-file/not-regular-file",
      details: { path: "src", kind: "directory" },
    })
    expect(await failure(files.read("s-main", "missing.md"))).toEqual({
      code: "bot-file/not-found",
      details: { path: "missing.md" },
    })
    expect((await failure(files.read("s-main", ""))).code).toBe("gateway/bad-request")
  })
})

describe("botFiles: readBytes", () => {
  it("reads a byte window and the complete file, base64", async () => {
    const { files } = setup()
    expect(
      await files.readBytes("s-main", "image.bin", { range: { offset: 2, length: 3 } }),
    ).toEqual({
      absolutePath: `${WORKSPACE}/image.bin`,
      version: "v1",
      bytes: 6,
      offset: 2,
      base64: btoa(String.fromCharCode(2, 3, 4)),
      eof: false,
    })
    const tail = await files.readBytes("s-main", "image.bin", { range: { offset: 4 } })
    expect(tail).toMatchObject({ base64: btoa(String.fromCharCode(4, 5)), eof: true })
    const whole = await files.readBytes("s-main", "image.bin", {})
    expect(whole).toMatchObject({ offset: 0, eof: true })
    expect(atob(whole.base64).length).toBe(6)
  })

  it("resolves a relative path from a base file's directory", async () => {
    const { files } = setup()
    const read = await files.readBytes("s-main", "lib/util.ts", { baseFile: "src/app.ts" })
    expect(read.absolutePath).toBe(`${WORKSPACE}/src/lib/util.ts`)
    expect(
      (await failure(files.readBytes("s-main", "/etc/hostname", { baseFile: "src/app.ts" }))).code,
    ).toBe("gateway/bad-request")
  })

  it("refuses windows above maxBytes and complete files above maxFileBytes", async () => {
    const { files, fake } = setup({ limits: { maxBytes: 4, maxFileBytes: 5 } })
    expect(await failure(files.readBytes("s-main", "image.bin", { range: { length: 5 } }))).toEqual(
      { code: "bot-file/too-large", details: { path: "image.bin", limit: 4 } },
    )
    let read = false
    fake.fs.readBytes = async () => {
      read = true
      return new Uint8Array()
    }
    expect(await failure(files.readBytes("s-main", "image.bin", {}))).toEqual({
      code: "bot-file/too-large",
      details: { path: "image.bin", limit: 5 },
    })
    // Refused from the stat, without transferring the file.
    expect(read).toBe(false)
  })
})

describe("botFiles: list", () => {
  it("lists the workspace and its directories with workspace-relative paths", async () => {
    const { files } = setup()
    const root = await files.list("s-main", "")
    expect(root.path).toBe("")
    expect(root.truncated).toBe(false)
    expect(root.entries.map((entry) => `${entry.name}:${entry.type}`)).toEqual([
      "image.bin:file",
      "inside:directory",
      "link.md:file",
      "notes.md:file",
      "outside:directory",
      "src:directory",
    ])
    expect(await files.list("s-main", "src")).toEqual({
      path: "src",
      entries: [
        { name: "app.ts", type: "file", size: 10 },
        { name: "lib", type: "directory" },
      ],
      truncated: false,
    })
    // A link to a directory inside the workspace lists as its target.
    expect((await files.list("s-main", "inside")).path).toBe("src")
  })

  it("stays inside the workspace and cuts long listings", async () => {
    const { files } = setup({ limits: { maxEntries: 2 } })
    expect((await files.list("s-main", "")).entries).toHaveLength(2)
    expect((await files.list("s-main", "")).truncated).toBe(true)
    for (const path of ["..", "/etc", "outside", `${WORKSPACE}/../..`]) {
      expect((await failure(files.list("s-main", path))).code).toBe("bot-file/outside-workspace")
    }
    expect(await failure(files.list("s-main", "notes.md"))).toEqual({
      code: "bot-file/not-directory",
      details: { path: "notes.md", kind: "file" },
    })
    expect(await failure(files.list("s-main", "link.md"))).toEqual({
      code: "bot-file/not-directory",
      details: { path: "link.md", kind: "symlink" },
    })
  })
})

describe("botFiles: search", () => {
  it("runs ripgrep in the environment, in the workspace, and infers directories", async () => {
    const run = fakeSubprocess(["notes.md", "src/app.ts", "src/lib/util.ts"])
    const { files } = setup({ subprocess: run.subprocess })
    const result = await files.search("s-main", { query: "LIB" })
    expect(result).toEqual({
      matches: [{ path: "src/lib", type: "directory" }],
      truncated: false,
      incomplete: false,
    })
    expect(run.spawned[0]?.cwd).toBe(WORKSPACE)
    expect(run.spawned[0]?.argv.slice(0, 6)).toEqual([
      "/usr/bin/rg",
      "--no-config",
      "--files",
      "--sort=path",
      "--null",
      "--path-separator=/",
    ])
    expect(run.spawned[0]?.argv).toContain("--glob=!.git")
    expect(run.spawned[0]?.argv).not.toContain("--hidden")
    // A query with "/" matches relative paths; matches sort by depth, then path.
    expect((await files.search("s-main", { query: "src/" })).matches.map((m) => m.path)).toEqual([
      "src/app.ts",
      "src/lib",
      "src/lib/util.ts",
    ])
    await files.search("s-main", {
      query: "x",
      includeHidden: true,
      respectGitignore: false,
      excludedPaths: ["node_modules", "a/*b"],
    })
    expect(run.spawned[2]?.argv).toEqual(
      expect.arrayContaining([
        "--hidden",
        "--no-ignore",
        "--glob=!node_modules",
        "--glob=!/a/\\*b",
      ]),
    )
  })

  it("caps results and listed files", async () => {
    const run = fakeSubprocess(["a1", "a2", "a3", "a4"])
    const { files } = setup({
      subprocess: run.subprocess,
      limits: { search: { ...DEFAULT_FILES_LIMITS.search, maxResults: 2 } },
    })
    expect(await files.search("s-main", { query: "a" })).toMatchObject({
      truncated: true,
      incomplete: false,
    })
    const bounded = setup({
      subprocess: run.subprocess,
      limits: { search: { ...DEFAULT_FILES_LIMITS.search, maxEntries: 2 } },
    })
    const result = await bounded.files.search("s-main", { query: "a" })
    expect(result.matches.map((match) => match.path)).toEqual(["a1", "a2"])
    expect(result.incomplete).toBe(true)
    expect(run.terminated()).toBe(1)
  })

  it("reports partial discovery, failures, a missing subprocess and the deadline", async () => {
    const partial = setup({ subprocess: fakeSubprocess(["a"], 2).subprocess })
    expect((await partial.files.search("s-main", { query: "a" })).incomplete).toBe(true)
    const none = setup({ subprocess: fakeSubprocess([], 1).subprocess })
    expect((await none.files.search("s-main", { query: "a" })).matches).toEqual([])
    const broken = setup({ subprocess: fakeSubprocess([], 3).subprocess })
    expect(await failure(broken.files.search("s-main", { query: "a" }))).toEqual({
      code: "bot-file/search-failed",
      details: {},
    })
    const missing = setup({ subprocess: undefined })
    expect((await failure(missing.files.search("s-main", { query: "a" }))).code).toBe(
      "bot-file/search-failed",
    )
    const late = setup({
      subprocess: fakeSubprocess(["a"]).subprocess,
      deadline: () => AbortSignal.abort(new Error("deadline")),
    })
    expect((await failure(late.files.search("s-main", { query: "a" }))).code).toBe(
      "bot-file/search-failed",
    )
    expect((await failure(partial.files.search("s-main", { query: "  " }))).code).toBe(
      "gateway/bad-request",
    )
  })

  it("keeps the listing when ripgrep's exit cannot be observed, and warns", async () => {
    const run = fakeSubprocess(["a"], 0, async () => {
      throw new Error("lost the process range")
    })
    const { files, warnings } = setup({ subprocess: run.subprocess })
    expect((await files.search("s-main", { query: "a" })).matches).toEqual([
      { path: "a", type: "file" },
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("lost the process range")
  })

  it("passes an absolute ripgrep path through unresolved", async () => {
    const run = fakeSubprocess(["a"])
    const { files } = setup({
      subprocess: run.subprocess,
      limits: { search: { ...DEFAULT_FILES_LIMITS.search, ripgrep: "/opt/rg" } },
    })
    await files.search("s-main", { query: "a" })
    expect(run.spawned[0]?.argv[0]).toBe("/opt/rg")
  })
})

describe("botFiles: cancellation and concurrency", () => {
  it("passes the caller's abort through as is, never as an environment failure", async () => {
    const { files, fake } = setup()
    const controller = new AbortController()
    const reason = new Error("caller went away")
    fake.fs.lstat = async (_path, _options, signal) => {
      controller.abort(reason)
      signal?.throwIfAborted()
      return undefined
    }
    await expect(files.stat("s-main", "notes.md", controller.signal)).rejects.toBe(reason)
    // Already aborted: nothing is asked.
    await expect(files.read("s-main", "notes.md", {}, controller.signal)).rejects.toBe(reason)
  })

  it("terminates ripgrep when the caller aborts a search", async () => {
    const controller = new AbortController()
    let terminated = 0
    let finish: () => void = () => {}
    const subprocess: EnvironmentSubprocess = {
      spawn() {
        const ended = new Promise<void>((resolve) => {
          finish = resolve
        })
        return {
          stdout: output(
            (async function* () {
              yield "a\0"
              controller.abort(new Error("stop"))
              await ended
            })(),
          ),
          collected: { stderr: { readFrom: () => ({ text: "" }) } },
          done: ended.then(() => ({ exitCode: null, signal: "SIGTERM" })),
          terminate() {
            terminated += 1
            finish()
          },
          waitForExit: async () => true,
        }
      },
      resolveExecutable: async () => {
        throw new Error("an absolute ripgrep is not resolved")
      },
    }
    const { files } = setup({
      subprocess,
      limits: { search: { ...DEFAULT_FILES_LIMITS.search, ripgrep: "/rg" } },
    })
    await expect(files.search("s-main", { query: "a" }, controller.signal)).rejects.toThrow("stop")
    expect(terminated).toBeGreaterThan(0)
  })

  it("runs at most maxConcurrent calls per bot; a waiting call can be aborted", async () => {
    const { files, fake } = setup({ limits: { maxConcurrent: 2 } })
    let active = 0
    let peak = 0
    const gates: (() => void)[] = []
    const lstat = fake.fs.lstat.bind(fake.fs)
    fake.fs.lstat = async (path, options, signal) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => gates.push(resolve))
      active -= 1
      return lstat(path, options, signal)
    }
    const calls = [1, 2, 3].map(() => files.stat("s-main", "notes.md"))
    const waiting = new AbortController()
    const aborted = files.stat("s-main", "notes.md", waiting.signal)
    await Promise.resolve()
    await Promise.resolve()
    expect(gates).toHaveLength(2)
    waiting.abort(new Error("gave up"))
    await expect(aborted).rejects.toThrow("gave up")
    while (gates.length > 0 || active > 0) {
      gates.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await Promise.all(calls)
    expect(peak).toBe(2)
  })

  it("bounds excludedPaths and the query", async () => {
    const { files } = setup({ subprocess: fakeSubprocess([]).subprocess })
    const many = Array.from({ length: 257 }, (_, index) => `n${index}`)
    for (const request of [
      { query: "a", excludedPaths: many },
      { query: "a", excludedPaths: ["x".repeat(1025)] },
      { query: "a", excludedPaths: [""] },
      { query: "q".repeat(1025) },
    ]) {
      expect((await failure(files.search("s-main", request))).code).toBe("gateway/bad-request")
    }
  })
})

describe("createEnvironmentFilesKeeper", () => {
  it("serves the newest attach with the asked token only", () => {
    const keeper = createEnvironmentFilesKeeper<string>()
    const old = keeper.attach("b1", "t1", "old")
    const retired = keeper.attach("b1", "t0", "retired")
    const next = keeper.attach("b1", "t1", "new")
    expect(keeper.get("b1", "t1")).toBe("new")
    // A retired revision re-attaching later never wins.
    expect(keeper.get("b1", "t2")).toBeUndefined()
    next()
    expect(keeper.get("b1", "t1")).toBe("old")
    old()
    old()
    expect(keeper.get("b1", "t1")).toBeUndefined()
    expect(keeper.get("b1", "t0")).toBe("retired")
    retired()
    expect(keeper.get("b2", "t1")).toBeUndefined()
  })
})
