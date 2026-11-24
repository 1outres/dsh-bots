import { readFileSync } from "node:fs" // rule: 14

export const read = () => readFileSync("x")
