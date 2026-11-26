import { describe, expect, it } from "vitest"
import { contentTypeOf, requestedPath, spacePathProblem } from "../src/host/spaces/paths"
import { readSnapshot } from "../src/host/spaces/snapshot"
import { SPACE_LIMITS } from "../src/shared/spaces"
import { memoryWorkspace, WORKSPACE } from "./support/spaces"

const read = (fs: ReturnType<typeof memoryWorkspace>) =>
  readSnapshot(fs, WORKSPACE, "demo", new AbortController().signal)

describe("Space paths", () => {
  it("types files by extension only, text as UTF-8", () => {
    expect(contentTypeOf("index.html")).toBe("text/html; charset=utf-8")
    expect(contentTypeOf("a/b.WOFF2")).toBe("font/woff2")
    expect(contentTypeOf("script.php")).toBeUndefined()
    expect(contentTypeOf("README")).toBeUndefined()
  })

  it("refuses hidden, reserved and odd names", () => {
    expect(spacePathProblem("_dsh/x.js")).toBe("reserved")
    expect(spacePathProblem("a/_dsh/x.js")).toBeUndefined()
    expect(spacePathProblem(".env.json")).toBe("hidden")
    expect(spacePathProblem("a b.html")).toBe("segment")
    expect(spacePathProblem("x.exe")).toBe("type")
  })

  it("maps a request to index.html and refuses traversal", () => {
    expect(requestedPath("")).toBe("index.html")
    expect(requestedPath("docs/")).toBe("docs/index.html")
    expect(requestedPath("%2e%2e/secret.html")).toBeUndefined()
    expect(requestedPath("a/../b.html")).toBeUndefined()
    expect(requestedPath("%E0%A4%A")).toBeUndefined()
  })
})

describe("readSnapshot", () => {
  it("reads the Space's files, skipping hidden ones", async () => {
    const fs = memoryWorkspace()
    fs.write("spaces/demo/index.html", "<p>hi</p>")
    fs.write("spaces/demo/css/site.css", "p{}")
    fs.write("spaces/demo/.draft.html", "x")
    const result = await read(fs)
    expect(result).toMatchObject({ ok: true, bytes: 12 })
    expect(result.ok && result.files.map((file) => [file.path, file.type])).toEqual([
      ["css/site.css", "text/css; charset=utf-8"],
      ["index.html", "text/html; charset=utf-8"],
    ])
  })

  it("lists every violation at once", async () => {
    const fs = memoryWorkspace()
    fs.write("spaces/demo/run.sh", "x")
    fs.write("spaces/demo/_dsh/a.js", "x")
    fs.write("spaces/demo/big.png", new Uint8Array(SPACE_LIMITS.fileBytes + 1))
    fs.write("/etc/secret.txt", "s")
    fs.links.set(`${WORKSPACE}/spaces/demo/link.txt`, "/etc/secret.txt")
    const result = await read(fs)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.violations).toEqual([
      "_dsh uses the reserved name _dsh",
      expect.stringContaining("big.png has 2 MiB"),
      "link.txt is a symbolic link; publish the file itself",
      "run.sh has an extension Spaces do not serve",
      "there is no spaces/demo/index.html, the page a Space opens with",
    ])
  })

  it("refuses a directory that resolves outside the Space", async () => {
    const fs = memoryWorkspace()
    fs.write("spaces/demo/index.html", "x")
    fs.write("/srv/other/leak.txt", "s")
    fs.links.set(`${WORKSPACE}/spaces/demo/assets`, "/srv/other")
    const result = await read(fs)
    expect(!result.ok && result.violations).toEqual([
      "assets is a symbolic link; publish the file itself",
    ])
  })

  it("refuses too many files and a missing directory", async () => {
    const fs = memoryWorkspace()
    expect(await read(fs)).toEqual({
      ok: false,
      violations: ["spaces/demo/ is not a directory in your workspace"],
    })
    fs.write("spaces/demo/index.html", "x")
    for (let index = 0; index < SPACE_LIMITS.filesPerRevision; index += 1) {
      fs.write(`spaces/demo/f${index}.txt`, "x")
    }
    const result = await read(fs)
    expect(!result.ok && result.violations).toEqual(["201 files, more than 200 per revision"])
  })
})
