/** What the Host modules take from the composition root (src/index.ts): time. */
export interface Scheduler {
  /** Run `work` after `ms`; the returned function cancels it. */
  later(ms: number, work: () => void): () => void
}
