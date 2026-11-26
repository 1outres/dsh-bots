import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface FakeAnswer {
  readonly stdout?: string
  readonly stderr?: string
  readonly code?: number
  readonly delayMs?: number
}

export interface FakeCall {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export interface FakeOp {
  readonly binary: string
  readonly directory: string
  answer(argv: string, answer: FakeAnswer): void
  calls(): readonly FakeCall[]
  remove(): void
}

export function createFakeOp(): FakeOp {
  const directory = mkdtempSync(join(tmpdir(), "fake-op-"))
  const binary = join(directory, "op")
  const scenario = join(directory, "scenario.json")
  const log = join(directory, "calls.jsonl")
  const answers: Record<string, FakeAnswer> = {}
  writeFileSync(scenario, "{}")
  writeFileSync(
    binary,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs")',
      "const argv = process.argv.slice(2)",
      "fs.appendFileSync(" +
        JSON.stringify(log) +
        ", JSON.stringify({ argv, env: process.env }) + '\\n')",
      "const answer = JSON.parse(fs.readFileSync(" +
        JSON.stringify(scenario) +
        ', "utf8"))[argv.join(" ")]',
      "const finish = () => {",
      "  if (answer === undefined) { process.stderr.write('[ERROR] unknown command'); process.exit(1) }",
      "  if (answer.stderr) process.stderr.write(answer.stderr)",
      "  process.stdout.write(answer.stdout ?? '', () => process.exit(answer.code ?? 0))",
      "}",
      "setTimeout(finish, answer?.delayMs ?? 0)",
      "",
    ].join("\n"),
  )
  chmodSync(binary, 0o700)
  return {
    binary,
    directory,
    answer(argv, answer) {
      answers[argv] = answer
      writeFileSync(scenario, JSON.stringify(answers))
    },
    calls: () =>
      existsSync(log)
        ? readFileSync(log, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as FakeCall)
        : [],
    remove: () => rmSync(directory, { recursive: true, force: true }),
  }
}
