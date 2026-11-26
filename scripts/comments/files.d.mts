import type { LanguageId, SourceFile } from "./contract.mjs"

export function isGenerated(path: string): boolean

export function extensionLanguageOf(path: string): LanguageId | null

export function needsShebang(path: string): boolean

export function languageOf(path: string, text: string): LanguageId | null

export function repositoryRoot(directory: string): string

export function trackedPaths(root: string): string[]

export function readSources(root: string, paths: readonly string[]): SourceFile[]

export function isTestPath(path: string): boolean
