export function schedule(work: () => void): void {
  setTimeout(work, 0)
  setInterval(work, 1000)
}
