import { describe, expect, it } from "vitest"
import { extractZipEntry, ZipError } from "../src/cli/zip"
import { makeZip } from "./support/zip"

const op = new TextEncoder().encode("#!/bin/sh\necho op\n".repeat(50))
const sig = new TextEncoder().encode("signature")

describe("extractZipEntry", () => {
  it("takes a deflated or stored file by its exact name", () => {
    const deflated = makeZip([
      { name: "op", data: op },
      { name: "op.sig", data: sig, method: 0 },
    ])
    expect(extractZipEntry(deflated, "op", 1 << 20)).toEqual(op)
    expect(extractZipEntry(deflated, "op.sig", 1 << 20)).toEqual(sig)
  })

  it("never takes a file of another name, whatever path it claims", () => {
    const zip = makeZip([
      { name: "../op", data: op },
      { name: "/op", data: op },
      { name: "bin/op", data: op },
    ])
    expect(() => extractZipEntry(zip, "op", 1 << 20)).toThrow("the zip has no op")
  })

  it("refuses two files of the name", () => {
    const zip = makeZip([
      { name: "op", data: op },
      { name: "op", data: sig },
    ])
    expect(() => extractZipEntry(zip, "op", 1 << 20)).toThrow(/twice/)
  })

  it("refuses an encrypted file and an unknown compression", () => {
    expect(() =>
      extractZipEntry(makeZip([{ name: "op", data: op, flags: 1 }]), "op", 1 << 20),
    ).toThrow(/encrypted/)
    expect(() =>
      extractZipEntry(makeZip([{ name: "op", data: op, method: 12 }]), "op", 1 << 20),
    ).toThrow(/unsupported compression/)
  })

  it("bounds the size, and refuses a file that inflates to another size", () => {
    const zip = makeZip([{ name: "op", data: op }])
    expect(() => extractZipEntry(zip, "op", op.length - 1)).toThrow(/larger than expected/)
    const lying = makeZip([{ name: "op", data: op, statedSize: 10 }])
    expect(() => extractZipEntry(lying, "op", 1 << 20)).toThrow(ZipError)
    const bomb = makeZip([{ name: "op", data: new Uint8Array(4 << 20), statedSize: 100 }])
    expect(() => extractZipEntry(bomb, "op", 1 << 20)).toThrow(ZipError)
  })

  it("refuses what is not a zip or is cut short", () => {
    expect(() => extractZipEntry(new Uint8Array(100), "op", 1 << 20)).toThrow("not a zip archive")
    const zip = makeZip([{ name: "op", data: op }])
    expect(() => extractZipEntry(zip.subarray(40), "op", 1 << 20)).toThrow(ZipError)
  })
})
