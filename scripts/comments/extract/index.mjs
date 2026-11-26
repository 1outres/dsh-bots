import { extractEcmascript } from "./ecmascript.mjs"
import { extractGrit } from "./grit.mjs"
import { extractPython } from "./python.mjs"
import { extractShell } from "./shell.mjs"
import { extractYaml } from "./yaml.mjs"

export const EXTRACTORS = {
  ecmascript: extractEcmascript,
  grit: extractGrit,
  shell: extractShell,
  python: extractPython,
  yaml: extractYaml,
}
