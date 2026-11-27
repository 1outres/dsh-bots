import { createHash } from "node:crypto"
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BotEnvironmentImageRelease, BotEnvironmentImageView } from "@1outres/dsh-bot-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { readReleaseEnv } from "../../../scripts/release/release-env.mjs"
import { createIncusBackend } from "../src/host/backend/incus/backend"
import type { IncusClient, IncusImage } from "../src/host/backend/incus/client"
import { createImporter, ImageStepError, type Importer } from "../src/host/image/importer"
import type { ImageFiles } from "../src/host/image/io"
import { createImageManager } from "../src/host/image/manager"
import { parseManifest } from "../src/host/image/manifest"
import { releaseOf } from "../src/host/image/release"
import { DSH_VERSION, IMAGE_TAG, MANIFEST_SHA256 } from "../src/host/image/release-env"
import { nodeImageFiles, nodeImageHttp, sha256 } from "../src/node/image-io"
import { incusWith } from "./support/incus"

const hex = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex")

describe("base image release", () => {
  it("is the one infra/release.env names", () => {
    const env = readReleaseEnv(join(import.meta.dirname, "../../.."))
    expect(IMAGE_TAG).toBe(env.IMAGE_TAG)
    expect(MANIFEST_SHA256).toBe(env.IMAGE_MANIFEST_SHA256)
    expect(DSH_VERSION).toBe(env.DSH_VERSION)
  })

  it("is the GitHub release, or a mirror given with its manifest's sha256", () => {
    expect(releaseOf({ baseUrl: "", manifestSha256: "" })).toEqual({
      ok: true,
      release: {
        tag: IMAGE_TAG,
        manifestSha256: MANIFEST_SHA256,
        baseUrl: `https://github.com/1outres/dsh-bots/releases/download/${IMAGE_TAG}`,
      },
    })
    expect(
      releaseOf({ baseUrl: "http://mirror/x/", manifestSha256: "a".repeat(64) }),
    ).toMatchObject({
      ok: true,
      release: { baseUrl: "http://mirror/x", manifestSha256: "a".repeat(64) },
    })
    for (const override of [
      { baseUrl: "http://mirror", manifestSha256: "" },
      { baseUrl: "", manifestSha256: "a".repeat(64) },
      { baseUrl: "ftp://mirror", manifestSha256: "a".repeat(64) },
      { baseUrl: "http://mirror", manifestSha256: "xyz" },
    ]) {
      expect(releaseOf(override)).toMatchObject({ ok: false, problem: { code: "release-unset" } })
    }
  })
})

const sha = (char: string) => char.repeat(64)

describe("image manifest", () => {
  const good = [
    "format 1",
    "dsh 0.2.2-rc.5",
    `image base.tar.zst 30 ${sha("a")}`,
    `part base.tar.zst.part00 20 ${sha("b")}`,
    `part base.tar.zst.part01 10 ${sha("c")}`,
    "",
  ].join("\n")

  it("reads what export-image.sh writes", () => {
    expect(parseManifest(good)).toEqual({
      ok: true,
      manifest: {
        dsh: "0.2.2-rc.5",
        image: { name: "base.tar.zst", bytes: 30, fingerprint: sha("a") },
        parts: [
          { name: "base.tar.zst.part00", bytes: 20, sha256: sha("b") },
          { name: "base.tar.zst.part01", bytes: 10, sha256: sha("c") },
        ],
      },
    })
  })

  it.each([
    ["another format", good.replace("format 1", "format 2"), "format 2"],
    ["no format", good.replace("format 1\n", ""), "format (none)"],
    ["parts that do not add up", good.replace("part01 10", "part01 11"), "31 bytes"],
    ["an unknown record", `${good}extra x\n`, 'unknown record "extra"'],
    ["a path as a name", good.replace("part base.tar.zst.part00", "part ../x"), '"../x"'],
    ["a short sha256", good.replace(sha("b"), "b"), "not a sha256"],
    ["a size that is not a number", good.replace("part00 20", "part00 2e1"), "not a size"],
    ["a part twice", good.replace("part01 10", "part00 10"), "appears twice"],
    ["two images", `${good}image b 30 ${sha("a")}\n`, '"image" appears twice'],
    [
      "no parts",
      good
        .split("\n")
        .filter((l) => !l.startsWith("part"))
        .join("\n"),
      "no parts",
    ],
    ["no DSH version", good.replace("dsh 0.2.2-rc.5\n", ""), "no DSH version"],
  ])("refuses %s", (_what, text, reason) => {
    const reading = parseManifest(text)
    expect(reading.ok).toBe(false)
    if (!reading.ok) expect(reading.reason).toContain(reason)
  })
})

interface Served {
  url: string
  requests: string[]
  cut: Map<string, number>
  ignoreRange: Set<string>
  files: Map<string, Buffer>
  close(): Promise<void>
}

async function serve(files: Map<string, Buffer>): Promise<Served> {
  const requests: string[] = []
  const cut = new Map<string, number>()
  const ignoreRange = new Set<string>()
  const server: Server = createServer((req, res) => {
    const name = (req.url ?? "").split("/").pop() ?? ""
    const range = req.headers.range
    requests.push(`${name} ${range ?? "-"}`)
    const file = files.get(name)
    if (file === undefined) {
      res.writeHead(404).end()
      return
    }
    let start = 0
    const match = /^bytes=(\d+)-$/.exec(range ?? "")
    if (match !== null && !ignoreRange.has(name)) {
      start = Number(match[1])
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${file.length - 1}/${file.length}`,
        "Content-Length": file.length - start,
      })
    } else res.writeHead(200, { "Content-Length": file.length })
    const body = file.subarray(start)
    const limit = cut.get(name)
    if (limit !== undefined) {
      cut.delete(name)
      res.write(body.subarray(0, limit), () => res.destroy())
      return
    }
    res.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/release`,
    requests,
    cut,
    ignoreRange,
    files,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

function release(): { files: Map<string, Buffer>; fingerprint: string; manifestSha256: string } {
  const image = Buffer.alloc(3 * 1024 * 1024 + 123)
  for (let index = 0; index < image.length; index++) image[index] = (index * 7919) % 251
  const parts = [image.subarray(0, 2 * 1024 * 1024), image.subarray(2 * 1024 * 1024)]
  const fingerprint = hex(image)
  const manifest = [
    "format 1",
    `dsh ${DSH_VERSION}`,
    `image base.tar.zst ${image.length} ${fingerprint}`,
    ...parts.map((part, index) => `part base.tar.zst.part0${index} ${part.length} ${hex(part)}`),
    "",
  ].join("\n")
  const files = new Map<string, Buffer>([
    ["manifest.txt", Buffer.from(manifest)],
    ["base.tar.zst.part00", Buffer.from(parts[0] as Buffer)],
    ["base.tar.zst.part01", Buffer.from(parts[1] as Buffer)],
  ])
  return { files, fingerprint, manifestSha256: hex(manifest) }
}

interface FakeImages {
  client: IncusClient
  images: Map<string, IncusImage>
  aliases: Map<string, string>
  uploads: number
  claim?: string
}

function fakeIncus(): FakeImages {
  const fake: FakeImages = {
    images: new Map(),
    aliases: new Map(),
    uploads: 0,
    client: incusWith({
      image: async (fingerprint) => {
        const image = fake.images.get(fingerprint)
        if (image === undefined) return undefined
        const aliases = [...fake.aliases].filter(([, target]) => target === fingerprint)
        return { ...image, aliases: aliases.map(([name]) => name) }
      },
      async importImage(body) {
        const hash = createHash("sha256")
        let size = 0
        for await (const chunk of body) {
          hash.update(chunk)
          size += chunk.length
        }
        fake.uploads++
        const fingerprint = fake.claim ?? hash.digest("hex")
        fake.images.set(fingerprint, { fingerprint, size, aliases: [] })
        return fingerprint
      },
      deleteImage: async (fingerprint) => {
        fake.images.delete(fingerprint)
      },
      alias: async (name) => fake.aliases.get(name),
      setAlias: async (name, fingerprint) => {
        fake.aliases.set(name, fingerprint)
      },
    }),
  }
  return fake
}

describe("image import", () => {
  let dir: string
  let served: Served
  let incus: FakeImages
  let made: ReturnType<typeof release>
  let chosen: BotEnvironmentImageRelease
  let files: ImageFiles
  const logs: string[] = []

  const importer = (): Importer =>
    createImporter({
      images: async () =>
        createIncusBackend({
          incus: incus.client,
          project: "dsh-bots",
          origin: "custom",
          uploadTimeoutMs: 10_000,
        }).images,
      files,
      http: nodeImageHttp({ stallMs: 5_000, userAgent: "test" }),
      sha256,
      dir,
      dshVersion: DSH_VERSION,
      log: (message) => logs.push(message),
    })

  async function run(subject = importer()) {
    const steps: string[] = []
    const manifest = await subject.manifest(chosen)
    await subject.run(chosen, manifest, "dsh-bot-base", (step, done, total) =>
      steps.push(`${step} ${done}/${total}`),
    )
    return steps
  }

  const failure = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(ImageStepError)
    return error as ImageStepError
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dsh-image-"))
    made = release()
    served = await serve(made.files)
    incus = fakeIncus()
    files = nodeImageFiles
    chosen = { tag: "image-test", manifestSha256: made.manifestSha256, baseUrl: served.url }
    logs.length = 0
  })

  afterEach(async () => {
    await served.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("downloads every part, uploads the verified image, points the alias at it and cleans up", async () => {
    incus.images.set(sha("0"), { fingerprint: sha("0"), size: 1, aliases: [] })
    incus.aliases.set("dsh-bot-base", sha("0"))
    const steps = await run()
    expect(incus.aliases.get("dsh-bot-base")).toBe(made.fingerprint)
    expect(incus.images.has(sha("0"))).toBe(false)
    expect(incus.uploads).toBe(1)
    const total = 3 * 1024 * 1024 + 123
    expect(steps).toContain(`download ${total}/${total}`)
    expect(steps).toContain(`upload ${total}/${total}`)
    expect(steps.at(-1)).toBe("alias 0/0")
    expect(readdirSync(join(dir, "downloads"))).toEqual([])
    expect(readdirSync(join(dir, "manifests"))).toEqual([`${made.manifestSha256}.txt`])
  })

  it("keeps an old image another alias names", async () => {
    incus.images.set(sha("0"), { fingerprint: sha("0"), size: 1, aliases: [] })
    incus.aliases.set("dsh-bot-base", sha("0"))
    incus.aliases.set("mine", sha("0"))
    await run()
    expect(incus.images.has(sha("0"))).toBe(true)
  })

  it("continues a cut download from where it stopped", async () => {
    served.cut.set("base.tar.zst.part00", 700_000)
    const error = await failure(run())
    expect(error.problem.code).toBe("part-unreachable")
    expect(error.step).toBe("download")
    const kept = statSync(
      join(dir, "downloads", made.manifestSha256, "base.tar.zst.part00.partial"),
    ).size
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThanOrEqual(700_000)
    await run()
    expect(served.requests.filter((request) => request.startsWith("base.tar.zst.part00"))).toEqual([
      "base.tar.zst.part00 -",
      `base.tar.zst.part00 bytes=${kept}-`,
    ])
    expect(incus.aliases.get("dsh-bot-base")).toBe(made.fingerprint)
  })

  it("does not download a part again that is already there and verified", async () => {
    served.cut.set("base.tar.zst.part01", 10)
    await failure(run())
    await run()
    expect(
      served.requests.filter((request) => request.startsWith("base.tar.zst.part00")),
    ).toHaveLength(1)
    expect(served.requests.filter((request) => request.startsWith("manifest.txt"))).toHaveLength(1)
  })

  it("keeps a part whose download ended before it was renamed, without a request", async () => {
    const done = join(dir, "downloads", made.manifestSha256)
    await nodeImageFiles.mkdir(done)
    writeFileSync(
      join(done, "base.tar.zst.part00.partial"),
      made.files.get("base.tar.zst.part00") as Buffer,
    )
    await run()
    expect(served.requests.filter((request) => request.startsWith("base.tar.zst.part00"))).toEqual(
      [],
    )
    expect(incus.aliases.get("dsh-bot-base")).toBe(made.fingerprint)
  })

  it("downloads a part anew when the server sends it from its start", async () => {
    served.cut.set("base.tar.zst.part00", 1000)
    await failure(run())
    served.ignoreRange.add("base.tar.zst.part00")
    await run()
    expect(incus.aliases.get("dsh-bot-base")).toBe(made.fingerprint)
  })

  it("refuses a manifest that is not the release's", async () => {
    chosen = { ...chosen, manifestSha256: sha("d") }
    const error = await failure(importer().manifest(chosen))
    expect(error.problem).toMatchObject({ code: "manifest-mismatch" })
    expect(error.step).toBe("manifest")
  })

  it("refuses a manifest for another DSH", async () => {
    const text = (made.files.get("manifest.txt") as Buffer)
      .toString()
      .replace(`dsh ${DSH_VERSION}`, "dsh 9.9.9")
    served.files.set("manifest.txt", Buffer.from(text))
    chosen = { ...chosen, manifestSha256: hex(text) }
    expect((await failure(importer().manifest(chosen))).problem.code).toBe("manifest-dsh-version")
  })

  it("says the manifest cannot be downloaded", async () => {
    served.files.delete("manifest.txt")
    const error = await failure(importer().manifest(chosen))
    expect(error.problem.code).toBe("manifest-unreachable")
    expect(error.problem.message).toContain("HTTP 404")
  })

  it("uses the kept manifest without the network", async () => {
    await importer().manifest(chosen)
    await served.close()
    await expect(importer().manifest(chosen)).resolves.toMatchObject({
      image: { fingerprint: made.fingerprint },
    })
  })

  it("throws away a part whose sha256 is not the manifest's", async () => {
    const part = made.files.get("base.tar.zst.part01") as Buffer
    served.files.set("base.tar.zst.part01", Buffer.from(part).fill(0, 0, 1))
    const error = await failure(run())
    expect(error.problem.code).toBe("part-mismatch")
    expect(readdirSync(join(dir, "downloads", made.manifestSha256))).toEqual([
      "base.tar.zst.part00",
    ])
    expect(incus.uploads).toBe(0)
  })

  it("refuses a part of another size than the manifest's", async () => {
    served.files.set("base.tar.zst.part01", Buffer.alloc(5))
    expect((await failure(run())).problem.code).toBe("part-mismatch")
  })

  it("stops before downloading when the disk has no room for it", async () => {
    files = { ...nodeImageFiles, freeBytes: async () => 1024 }
    const error = await failure(run())
    expect(error.problem.code).toBe("disk-space")
    expect(served.requests.some((request) => request.startsWith("base"))).toBe(false)
  })

  it("deletes the image again when Incus reports another fingerprint, and leaves the alias", async () => {
    incus.claim = sha("e")
    const error = await failure(run())
    expect(error.problem.code).toBe("fingerprint-mismatch")
    expect(incus.images.has(sha("e"))).toBe(false)
    expect(incus.aliases.has("dsh-bot-base")).toBe(false)
  })

  it("only points the alias when the project already has the image", async () => {
    incus.images.set(made.fingerprint, { fingerprint: made.fingerprint, size: 1, aliases: [] })
    await run()
    expect(incus.uploads).toBe(0)
    expect(served.requests.some((request) => request.startsWith("base"))).toBe(false)
    expect(incus.aliases.get("dsh-bot-base")).toBe(made.fingerprint)
  })

  it("removes the downloads of other releases", async () => {
    const stale = join(dir, "downloads", sha("f"))
    await nodeImageFiles.mkdir(stale)
    writeFileSync(join(stale, "x.part00"), "x")
    await run()
    expect(readdirSync(join(dir, "downloads"))).toEqual([])
  })

  it("stops at an abort, keeping what was downloaded", async () => {
    const controller = new AbortController()
    const subject = importer()
    const manifest = await subject.manifest(chosen)
    const running = subject.run(
      chosen,
      manifest,
      "dsh-bot-base",
      (step, done) => {
        if (step === "download" && done > 1_000_000) controller.abort(new Error("stop"))
      },
      controller.signal,
    )
    await expect(running).rejects.toThrow()
    const kept = readdirSync(join(dir, "downloads", made.manifestSha256))
    expect(kept).toEqual(["base.tar.zst.part00.partial"])
    expect(
      readFileSync(join(dir, "downloads", made.manifestSha256, kept[0] as string)).length,
    ).toBeGreaterThan(0)
  })
})

describe("image manager", () => {
  const view = { tag: "t", manifestSha256: sha("1"), baseUrl: "http://x" }
  const manifest = {
    dsh: DSH_VERSION,
    image: { name: "base", bytes: 10, fingerprint: sha("2") },
    parts: [{ name: "base.part00", bytes: 10, sha256: sha("2") }],
  }

  function harness(options: { managed?: boolean; project?: string | undefined } = {}) {
    let target: string | undefined
    let release: (() => void) | undefined
    let fail: ((error: Error) => void) | undefined
    const runs: AbortSignal[] = []
    const importer: Importer = {
      manifest: async () => manifest,
      target: async () => target,
      run: (_release, _manifest, _alias, progress, signal) =>
        new Promise<void>((resolve, reject) => {
          runs.push(signal as AbortSignal)
          progress("download", 5, 10)
          release = () => {
            target = sha("2")
            resolve()
          }
          fail = reject
          signal?.addEventListener("abort", () => reject(signal.reason))
        }),
      clearDownloads: async () => {},
    }
    const views: BotEnvironmentImageView[] = []
    const manager = createImageManager(
      {
        alias: "dsh-bot-base",
        managed: options.managed ?? true,
        release: { ok: true, release: view },
      },
      {
        importer,
        place: () => ("project" in options ? options.project : "dsh-bots"),
        now: () => 7,
        log: () => {},
      },
    )
    manager.subscribe((next) => views.push(next))
    return {
      manager,
      views,
      runs,
      setTarget: (value: string | undefined) => {
        target = value
      },
      finish: () => release?.(),
      fail: (error: Error) => fail?.(error),
    }
  }

  const tick = () => new Promise((resolve) => setImmediate(resolve))

  it("imports once for every bot and the screen that wait for it", async () => {
    const h = harness()
    const reported: string[] = []
    const first = h.manager.ready(undefined, () => reported.push("a"))
    const second = h.manager.ready(undefined, () => reported.push("b"))
    await tick()
    h.manager.start()
    expect(h.runs).toHaveLength(1)
    expect(h.manager.view().status).toEqual({
      kind: "importing",
      progress: { step: "download", doneBytes: 5, totalBytes: 10 },
      since: 7,
    })
    h.finish()
    await Promise.all([first, second])
    expect(reported).toEqual(["a", "b"])
    expect(h.manager.view()).toMatchObject({
      place: "dsh-bots",
      image: manifest.image,
      status: { kind: "ready", fingerprint: sha("2") },
    })
  })

  it("does not wait or import when the alias points at the release's image", async () => {
    const h = harness()
    h.setTarget(sha("2"))
    const reported: string[] = []
    await h.manager.ready(undefined, () => reported.push("x"))
    expect(reported).toEqual([])
    expect(h.runs).toHaveLength(0)
  })

  it("tells another image the alias points at", async () => {
    const h = harness()
    h.setTarget(sha("3"))
    await expect(h.manager.refresh()).resolves.toMatchObject({
      status: { kind: "missing", current: sha("3") },
    })
  })

  it("stops waiting at the waiter's abort without stopping the import", async () => {
    const h = harness()
    const controller = new AbortController()
    const waiting = h.manager.ready(controller.signal, () => {})
    await tick()
    controller.abort(new Error("bot removed"))
    await expect(waiting).rejects.toThrow("bot removed")
    expect(h.runs[0]?.aborted).toBe(false)
    h.finish()
  })

  it("reports a cancelled import as failed, and fails the waiting ensure with the reason", async () => {
    const h = harness()
    const waiting = h.manager.ready(undefined, () => {})
    await tick()
    h.manager.cancel()
    await expect(waiting).rejects.toThrow(/not ready: the import was cancelled/)
    expect(h.manager.view().status).toMatchObject({
      kind: "failed",
      step: "download",
      problem: { code: "cancelled" },
    })
  })

  it("shows why an import failed and fails ensure with it", async () => {
    const h = harness()
    const waiting = h.manager.ready(undefined, () => {})
    await tick()
    h.fail(
      new ImageStepError("download", { code: "part-mismatch", message: "bad part", fix: "again" }),
    )
    await expect(waiting).rejects.toThrow("bad part (again)")
    expect(h.manager.view().status).toMatchObject({
      kind: "failed",
      problem: { code: "part-mismatch" },
    })
    expect(h.views.map((next) => next.status.kind)).toContain("importing")
  })

  it("does not let a check that ends during an import hide it", async () => {
    const h = harness()
    const checking = h.manager.refresh()
    h.manager.start()
    await checking
    expect(h.manager.view().status.kind).toBe("importing")
    h.finish()
  })

  it("uses an unmanaged alias as it is and never imports", async () => {
    const h = harness({ managed: false })
    expect(() => h.manager.start()).toThrow("not managed")
    await expect(h.manager.ready(undefined, () => {})).rejects.toThrow(/does not exist/)
    h.setTarget(sha("9"))
    await h.manager.ready(undefined, () => {})
    expect(h.manager.view()).toMatchObject({
      managed: false,
      status: { kind: "ready", fingerprint: sha("9") },
    })
    expect(h.manager.view().release).toBeUndefined()
  })

  it("stops while no VM host is decided", async () => {
    const h = harness({ project: undefined })
    await expect(h.manager.refresh()).resolves.toMatchObject({
      status: { kind: "failed", step: "check", problem: { code: "host-unset" } },
    })
    expect(h.manager.view().place).toBeUndefined()
    h.manager.start()
    await tick()
    expect(h.runs).toHaveLength(0)
    expect(h.manager.view().status).toMatchObject({
      kind: "failed",
      problem: { code: "host-unset" },
    })
  })
})
