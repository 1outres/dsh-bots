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
