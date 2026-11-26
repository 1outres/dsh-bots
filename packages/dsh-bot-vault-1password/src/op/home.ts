import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import type { OpHomePaths } from "./environment"

export interface OpHome extends OpHomePaths {
  remove(): Promise<void>
}

export async function createOpHome(parent: string): Promise<OpHome> {
  const home = await mkdtemp(join(parent, "dsh-op-"))
  const config = join(home, "config")
  try {
    await chmod(home, 0o700)
    await mkdir(config, { mode: 0o700 })
    await chmod(config, 0o700)
  } catch (error) {
    await rm(home, { recursive: true, force: true })
    throw error
  }
  return {
    home,
    config,
    remove: () => rm(home, { recursive: true, force: true }),
  }
}
