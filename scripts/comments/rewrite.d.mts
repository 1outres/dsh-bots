import type { Diagnostic } from "./contract.mjs"

export function applyFixes(text: string, diagnostics: readonly Diagnostic[]): string
