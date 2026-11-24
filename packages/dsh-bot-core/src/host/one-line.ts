/** One line of outside text: no line breaks or control characters, so it cannot fake a line the system writes. */
export function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ").trim()
}
