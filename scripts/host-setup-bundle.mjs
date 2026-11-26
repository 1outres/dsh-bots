import { createHash } from "node:crypto"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const HOST_SETUP_BUNDLE_DIR = "packages/dsh-bot-vm/lib/host-setup"

export const HOST_SETUP_FILES = [
  { path: "vm/host-setup.sh", source: "infra/vm/host-setup.sh", mode: 0o755 },
  { path: "vm/lib.sh", source: "infra/vm/lib.sh", mode: 0o644 },
  { path: "incus/objects.sh", source: "infra/incus/objects.sh", mode: 0o644 },
  { path: "release.env", source: "infra/release.env", mode: 0o644 },
]

const sha256 = (content) => createHash("sha256").update(content).digest("hex")

export function bundleDigestText(entries) {
  return [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.mode.toString(8).padStart(4, "0")} ${entry.sha256} ${entry.path}\n`)
    .join("")
}

export async function hostSetupManifest(root) {
  const files = []
  for (const file of HOST_SETUP_FILES) {
    files.push({
      path: file.path,
      mode: file.mode,
      sha256: sha256(await readFile(join(root, file.source))),
    })
  }
  return { version: 1, sha256: sha256(bundleDigestText(files)), files }
}

export async function writeHostSetupBundle(root, outDir = join(root, HOST_SETUP_BUNDLE_DIR)) {
  await rm(outDir, { recursive: true, force: true })
  for (const file of HOST_SETUP_FILES) {
    const target = join(outDir, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await readFile(join(root, file.source)))
    await chmod(target, file.mode)
  }
  const manifest = await hostSetupManifest(root)
  await writeFile(join(outDir, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}
