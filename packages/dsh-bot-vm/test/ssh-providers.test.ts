/**
 * dsh-fs-ssh and dsh-subprocess-ssh, unchanged, on this package's ssh service
 * (its copy of dsh-ssh's connection) with dsh-ssh's real helper: a stub ssh
 * on PATH runs the helper locally and forwards its streams. Every ssh
 * invocation must carry the bot's -F config.
 */
import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Context, Service } from "@deepseek-ai/cordis"
import SshSubprocessRuntime from "@deepseek-ai/dsh-subprocess-ssh"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import BotVmFileSystem from "../src/plugins/fs"
import FullAccessSandboxPolicy from "../src/plugins/full-access-policy"
import BotVmSsh from "../src/plugins/ssh"

const require = createRequire(import.meta.url)
const helper = join(require.resolve("@deepseek-ai/dsh-ssh/protocol"), "..", "helper.js")

let dir: string
let path: string | undefined
let workspace: string
let configFile: string
let log: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ssh-providers-"))
  mkdirSync(join(dir, "bin"))
  copyFileSync(
    fileURLToPath(new URL("./support/ssh-stub.mjs", import.meta.url)),
    join(dir, "bin", "ssh"),
  )
  chmodSync(join(dir, "bin", "ssh"), 0o755)
  workspace = join(dir, "workspace")
  mkdirSync(workspace)
  configFile = join(dir, "bot.conf")
  writeFileSync(configFile, "Host dsh-bot-test\n")
  log = join(dir, "ssh.log")
  writeFileSync(log, "")
  path = process.env.PATH
  process.env.PATH = `${join(dir, "bin")}:${path ?? ""}`
  process.env.SSH_STUB_LOG = log
})

afterAll(() => {
  process.env.PATH = path
  rmSync(dir, { recursive: true, force: true })
})

/** What the full-access policy's base service injects; sessions ask nothing here. */
class Projections extends Service {
  constructor(ctx: Context) {
    super(ctx, "sessionProjections")
  }
  async register() {
    return { stateOf: () => undefined }
  }
}

interface Spawned {
  stdin: NodeJS.WritableStream
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  done: Promise<{ exitCode: number | null }>
}

describe("SSH providers on the bot-vm ssh service", () => {
  it("reads, writes and runs through the helper, with the bot's config", async () => {
    const root = new Context()
    const ssh = root.plugin(BotVmSsh, {
      host: "dsh-bot-test",
      configFile,
      launch: { kind: "node-script", node: process.execPath },
      helper,
      helperHash: createHash("sha256").update(readFileSync(helper)).digest("hex"),
      workspace,
    })
    const fibers = [
      ssh,
      root.plugin(Projections),
      root.plugin(FullAccessSandboxPolicy, { workspaceRoot: workspace }),
      root.plugin(BotVmFileSystem),
      root.plugin(SshSubprocessRuntime),
    ]
    await Promise.all(fibers)
    for (
      let wait = 0;
      wait < 100 && (root.get("fs") === undefined || root.get("subprocess") === undefined);
      wait++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const fs = root.get("fs") as {
      resolve(path: string): Promise<unknown>
      writeText(target: unknown, text: string): Promise<unknown>
      readText(target: unknown): Promise<string>
    }
    const subprocess = root.get("subprocess") as { spawn(options: object): Spawned }
    const target = await fs.resolve(join(workspace, "note.txt"))
    await fs.writeText(target, "hello from the helper\n")
    expect(readFileSync(join(workspace, "note.txt"), "utf8")).toBe("hello from the helper\n")
    expect(await fs.readText(target)).toBe("hello from the helper\n")

    const child = subprocess.spawn({
      argv: ["sh", "-c", "tr a-z A-Z; echo done >&2"],
      cwd: workspace,
      stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      graceMs: 2_000,
    })
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    const drained = new Promise((resolve) => child.stdout.once("end", resolve))
    const errors: Buffer[] = []
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk))
    child.stdin.end("streamed\n")
    expect((await child.done).exitCode).toBe(0)
    await drained
    expect(Buffer.concat(chunks).toString()).toBe("STREAMED\n")
    expect(Buffer.concat(errors).toString()).toBe("done\n")

    for (const fiber of fibers.reverse()) await fiber.dispose()
    const invocations = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[])
    expect(invocations.length).toBeGreaterThan(1)
    for (const argv of invocations) expect(argv.slice(0, 2)).toEqual(["-F", configFile])
  }, 30_000)
})
