import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { collect, type HostSetupBundle } from "../src/host/setup/shell"
import {
  authorizedKeysLine,
  parseKeyscan,
  removeAuthorizedKeyScript,
} from "../src/host/setup/ssh-files"
import { localShell, privilegedArgv, sshShell } from "../src/node/setup-shell"

const content = (text: string) => new TextEncoder().encode(text)
const sha = async (text: string) => {
  const { createHash } = await import("node:crypto")
  return createHash("sha256").update(text).digest("hex")
}

let dir: string
let path: string | undefined
const site = {
  kind: "ssh" as const,
  host: "vm",
  port: 22,
  user: "a",
  hostKey: { type: "ssh-ed25519", fingerprint: "SHA256:x" },
  identity: "kept" as const,
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "setup-shell-"))
  writeFileSync(
    join(dir, "ssh"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${dir}/ssh.log"`,
      `if [ -f "${dir}/changed" ]; then echo '@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@' >&2; echo 'Host key verification failed.' >&2; exit 255; fi`,
      'while [ "$1" != "--" ]; do shift; done; shift',
      'exec sh -c "$1"',
      "",
    ].join("\n"),
  )
  chmodSync(join(dir, "ssh"), 0o755)
  path = process.env.PATH
  process.env.PATH = `${dir}:${path}`
})

afterAll(() => {
  process.env.PATH = path
  rmSync(dir, { recursive: true, force: true })
})

describe("the commands a HostShell runs", () => {
  it("runs root through one sudo that reads the password from stdin, and never through a shell locally", () => {
    const env = { PROJECT: "p q" }
    expect(
      privilegedArgv({
        argv: ["bash", "x.sh"],
        env,
        privilege: { kind: "root", via: "sudo", password: "pw" },
      }),
    ).toEqual(["sudo", "-S", "-p", "", "--", "env", "PROJECT=p q", "bash", "x.sh"])
    expect(
      privilegedArgv({
        argv: ["bash", "x.sh"],
        env,
        privilege: { kind: "root", via: "sudo", password: undefined },
      }),
    ).toEqual(["sudo", "-n", "--", "env", "PROJECT=p q", "bash", "x.sh"])
    expect(
      privilegedArgv({
        argv: ["bash", "x.sh"],
        env,
        privilege: { kind: "root", via: "already-root" },
      }),
    ).toEqual(["env", "PROJECT=p q", "bash", "x.sh"])
    expect(() =>
      privilegedArgv({ argv: ["x"], env: { "A;B": "1" }, privilege: { kind: "user" } }),
    ).toThrow()
  })

  it("passes stdin control lines to a local process", async () => {
    const shell = localShell(dir)
    const process_ = shell.run({
      argv: ["sh", "-c", 'read line; echo "got $line"; echo oops >&2'],
      env: { X: "1" },
      privilege: { kind: "user" },
    })
    process_.control("cancel")
    const run = await collect(process_)
    expect(run).toEqual({
      exit: { code: 0, signal: null },
      stdout: ["got cancel"],
      stderr: ["oops"],
    })
  })

  it("stages the bundle in a private temporary directory over ssh, checks it and removes it", async () => {
    const files = [
      { path: "vm/host-setup.sh", mode: 0o755, text: "#!/bin/sh\necho hi\n" },
      { path: "release.env", mode: 0o644, text: "A=1\n" },
    ]
    const bundle: HostSetupBundle = {
      sha256: "f".repeat(64),
      files: await Promise.all(
        files.map(async (file) => ({
          path: file.path,
          mode: file.mode,
          content: content(file.text),
          sha256: await sha(file.text),
        })),
      ),
    }
    const shell = sshShell(join(dir, "config"), site)
    const staged = await shell.stage(bundle)
    expect(readFileSync(join(staged.dir, "vm/host-setup.sh"), "utf8")).toBe("#!/bin/sh\necho hi\n")
    const run = await collect(
      shell.run({
        argv: ["sh", `${staged.dir}/vm/host-setup.sh`],
        env: {},
        privilege: { kind: "user" },
      }),
    )
    expect(run.stdout).toEqual(["hi"])
    expect(readFileSync(join(dir, "ssh.log"), "utf8")).toContain(
      `-F ${join(dir, "config")} -T dsh-bots-vm-host --`,
    )
    await staged.release()
    expect(existsSync(staged.dir)).toBe(false)
    const tampered = {
      ...bundle,
      files: [{ ...(bundle.files[0] as HostSetupBundle["files"][number]), sha256: "0".repeat(64) }],
    }
    await expect(shell.stage(tampered)).rejects.toMatchObject({ code: "staging-failed" })
  })

  it("tells a changed host key from other ssh failures", async () => {
    writeFileSync(join(dir, "changed"), "")
    try {
      const run = await collect(
        sshShell(join(dir, "config"), site).run({
          argv: ["true"],
          env: {},
          privilege: { kind: "user" },
        }),
      )
      expect(run.exit.broken?.code).toBe("host-key-changed")
    } finally {
      rmSync(join(dir, "changed"))
    }
  })
})

describe("SSH files", () => {
  it("keeps one line per scanned key and restricts the authorized key", () => {
    expect(
      parseKeyscan(
        "# vm:22 SSH-2.0\nvm ssh-ed25519 AAAA\nvm ssh-ed25519 AAAA\nvm ecdsa-sha2-nistp256 BBBB=\n",
      ),
    ).toEqual([
      { type: "ssh-ed25519", line: "ssh-ed25519 AAAA" },
      { type: "ecdsa-sha2-nistp256", line: "ecdsa-sha2-nistp256 BBBB=" },
    ])
    expect(authorizedKeysLine("ssh-ed25519 AAAA dsh-bots@h\n")).toBe(
      "restrict ssh-ed25519 AAAA dsh-bots@h",
    )
  })

  it("removes only the lines with this installation's key from authorized_keys", async () => {
    const home = mkdtempSync(join(tmpdir(), "home-"))
    try {
      const { mkdirSync } = await import("node:fs")
      mkdirSync(join(home, ".ssh"))
      writeFileSync(
        join(home, ".ssh/authorized_keys"),
        "ssh-ed25519 OTHER me\nrestrict ssh-ed25519 MINE dsh-bots@h\n",
        { mode: 0o600 },
      )
      const { execFileSync } = await import("node:child_process")
      execFileSync("sh", ["-c", removeAuthorizedKeyScript("MINE")], {
        env: { ...process.env, HOME: home },
      })
      expect(readFileSync(join(home, ".ssh/authorized_keys"), "utf8")).toBe(
        "ssh-ed25519 OTHER me\n",
      )
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
