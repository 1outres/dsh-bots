export interface Scheduler {
  later(ms: number, work: () => void): () => void
}
