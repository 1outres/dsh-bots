export function schedule(work: () => void): void {
  setTimeout(work, 0) // rule: 26
  setInterval(work, 1000) // rule: 26
}
