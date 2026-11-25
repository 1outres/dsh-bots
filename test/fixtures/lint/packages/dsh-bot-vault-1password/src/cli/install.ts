import { writeFile } from "node:fs/promises"

declare const binary: Uint8Array

export const install = () => writeFile("/data/op", binary, { flag: "wx", mode: 0o700 })
