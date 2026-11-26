import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import type { SetupFiles } from "../host/setup/store"

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT"

async function writeAtomically(path: string, content: string | Buffer, mode: number) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, content, { mode })
  await chmod(temporary, mode)
  await rename(temporary, path)
}

export const nodeSetupFiles: SetupFiles = {
  async read(path) {
    try {
      return await readFile(path, "utf8")
    } catch (error) {
      if (missing(error)) return undefined
      throw error
    }
  },
  write: writeAtomically,
  async append(path, content, mode, capBytes) {
    await appendFile(path, content, { mode })
    await chmod(path, mode)
    const { size } = await stat(path)
    if (size <= capBytes) return
    const whole = await readFile(path)
    const kept = whole.subarray(whole.length - Math.floor(capBytes / 2))
    const start = kept.indexOf(0x0a) + 1
    await writeAtomically(path, kept.subarray(start), mode)
  },
  async mkdir(path, mode) {
    await mkdir(path, { recursive: true, mode })
    await chmod(path, mode)
  },
  async list(dir) {
    try {
      return await readdir(dir)
    } catch (error) {
      if (missing(error)) return []
      throw error
    }
  },
  async remove(path) {
    await rm(path, { recursive: true, force: true })
  },
}
