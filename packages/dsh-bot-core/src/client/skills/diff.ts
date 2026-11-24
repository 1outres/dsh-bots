import type { SkillFile } from "../../shared/skills"

export interface DiffLine {
  readonly kind: "same" | "added" | "removed"
  readonly text: string
}

/** A file's change from one version to the next. */
export interface FileChange {
  readonly path: string
  readonly kind: "added" | "removed" | "changed" | "same"
  readonly lines: readonly DiffLine[]
}

const linesOf = (text: string) => (text === "" ? [] : text.replace(/\n$/, "").split("\n"))

/** The lines of `after` against `before` (a longest common subsequence of lines). */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = linesOf(before)
  const b = linesOf(after)
  const width = b.length + 1
  const lengths = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        a[i] === b[j]
          ? (lengths[(i + 1) * width + j + 1] as number) + 1
          : Math.max(lengths[(i + 1) * width + j] as number, lengths[i * width + j + 1] as number)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] as string })
      i += 1
      j += 1
    } else if ((lengths[(i + 1) * width + j] as number) >= (lengths[i * width + j + 1] as number)) {
      out.push({ kind: "removed", text: a[i] as string })
      i += 1
    } else {
      out.push({ kind: "added", text: b[j] as string })
      j += 1
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: "removed", text: a[i] as string })
  for (; j < b.length; j += 1) out.push({ kind: "added", text: b[j] as string })
  return out
}

/** Every file of either version, SKILL.md first, with its lines against the earlier version. */
export function fileChanges(
  before: readonly SkillFile[],
  after: readonly SkillFile[],
): FileChange[] {
  const paths = [...new Set([...before, ...after].map((file) => file.path))].sort((x, y) =>
    x === "SKILL.md" ? -1 : y === "SKILL.md" ? 1 : x.localeCompare(y),
  )
  return paths.map((path) => {
    const old = before.find((file) => file.path === path)?.text
    const now = after.find((file) => file.path === path)?.text
    const lines = diffLines(old ?? "", now ?? "")
    const kind =
      old === undefined ? "added" : now === undefined ? "removed" : old === now ? "same" : "changed"
    return { path, kind, lines }
  })
}
