export function decodeWords(value: string): string

export interface ParsedMime {
  readonly headers: Readonly<Record<string, string>>
  readonly text: string
  readonly attachments: readonly {
    readonly filename: string
    readonly mimeType: string
    readonly data: Buffer
  }[]
}

export function parseMime(raw: string): ParsedMime
