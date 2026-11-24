/**
 * What the model sees of a session now: the log's surface operations replayed
 * from the start (dsh-session `foldSurface`). An `append` adds its event at
 * the tail; a `replace` (a compaction) puts its event in place of the
 * surface nodes from `startSeq` through `endSeq`, by position, since earlier
 * replacements leave the surface out of seq order.
 */

/** One event of a session's log, as far as its place on the surface is read. */
export interface SurfaceEvent {
  readonly seq: number
  readonly surfaceOp?: unknown
}

type SurfaceOp =
  | { readonly op: "append" }
  | { readonly op: "replace"; readonly startSeq: number; readonly endSeq: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

function surfaceOpOf(event: SurfaceEvent): SurfaceOp | undefined {
  const { surfaceOp } = event
  if (surfaceOp === undefined) return undefined
  if (surfaceOp === "append") return { op: "append" }
  if (
    isRecord(surfaceOp) &&
    surfaceOp.op === "replace" &&
    Number.isSafeInteger(surfaceOp.startSeq) &&
    Number.isSafeInteger(surfaceOp.endSeq)
  ) {
    return {
      op: "replace",
      startSeq: surfaceOp.startSeq as number,
      endSeq: surfaceOp.endSeq as number,
    }
  }
  throw new Error(`event #${event.seq} carries a surface operation this reader does not know`)
}

/**
 * The seqs of the events on the surface after the whole log, in the order the model sees them.
 * @throws when a replacement names a range that is not on the surface.
 */
export function surfaceOf(events: readonly SurfaceEvent[]): readonly number[] {
  const nodes: number[] = []
  for (const event of events) {
    const op = surfaceOpOf(event)
    if (op === undefined) continue
    if (op.op === "append") {
      nodes.push(event.seq)
      continue
    }
    const start = nodes.indexOf(op.startSeq)
    const end = nodes.indexOf(op.endSeq)
    if (start < 0 || end < start) {
      throw new Error(
        `event #${event.seq} replaces #${op.startSeq}–#${op.endSeq}, which is not a range of the surface`,
      )
    }
    nodes.splice(start, end - start + 1, event.seq)
  }
  return nodes
}
