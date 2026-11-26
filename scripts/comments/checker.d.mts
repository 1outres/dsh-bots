import type { CheckContext, FileReport, SourceFile } from "./contract.mjs"

export function checkSources(
  sources: readonly SourceFile[],
  context: CheckContext,
): Promise<FileReport[]>
