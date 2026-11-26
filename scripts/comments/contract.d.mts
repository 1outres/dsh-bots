export type LanguageId = "ecmascript" | "grit" | "shell" | "python" | "yaml"

export type CommentKind = "line" | "block" | "jsx" | "hash" | "hashbang"

export interface Span {
  readonly start: number
  readonly end: number
}

export interface SourceFile {
  readonly path: string
  readonly language: LanguageId
  readonly text: string
}

export interface SourceComment {
  readonly file: string
  readonly kind: CommentKind
  readonly text: string
  readonly body: string
  readonly line: number
  readonly column: number
  readonly span: Span
}

export type Extractor = (files: readonly SourceFile[]) => Promise<SourceComment[][]>

export type BiomeIgnoreVariant = "ignore" | "ignore-all" | "ignore-start" | "ignore-end"

export type TypescriptDirectiveName = "ts-expect-error" | "ts-ignore" | "ts-nocheck"

export type Directive =
  | { readonly kind: "hashbang" }
  | {
      readonly kind: "biome-ignore"
      readonly variant: BiomeIgnoreVariant
      readonly category: string
      readonly reason: string | null
    }
  | {
      readonly kind: "typescript"
      readonly name: TypescriptDirectiveName
      readonly description: string
    }
  | { readonly kind: "noqa"; readonly codes: readonly string[] | null }
  | { readonly kind: "shellcheck"; readonly key: string; readonly value: string }
  | { readonly kind: "prose" }

export type RuleNumber = 73 | 74 | 75

export type Fix = { readonly kind: "remove" } | { readonly kind: "replace"; readonly text: string }

export interface Diagnostic {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly span: Span
  readonly rule: RuleNumber
  readonly message: string
  readonly fix: Fix | null
}

export interface RuleContext {
  readonly isTest: boolean
  readonly biomeRules: ReadonlySet<string>
}

export interface CheckContext {
  readonly biomeRules: ReadonlySet<string>
}

export interface FileReport {
  readonly file: SourceFile
  readonly comments: readonly SourceComment[]
  readonly diagnostics: readonly Diagnostic[]
}
