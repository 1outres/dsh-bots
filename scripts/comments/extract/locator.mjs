export function createLocator(text) {
  const lineStarts = [0]
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    lineStarts.push(index + 1)
  }
  return {
    position(offset) {
      let low = 0
      let high = lineStarts.length - 1
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (lineStarts[middle] <= offset) low = middle
        else high = middle - 1
      }
      return { line: low + 1, column: offset - lineStarts[low] + 1 }
    },
    lineStart(line) {
      return lineStarts[line - 1]
    },
  }
}

export function createUtf8Index(text) {
  const indexes = []
  let index = 0
  for (const character of text) {
    const bytes = Buffer.byteLength(character, "utf8")
    for (let byte = 0; byte < bytes; byte++) indexes.push(index)
    index += character.length
  }
  indexes.push(index)
  return (byteOffset) => {
    const result = indexes[byteOffset]
    if (result === undefined) throw new Error(`byte offset ${byteOffset} is outside the text`)
    return result
  }
}

export function codePointIndex(text, from, codePoints) {
  let index = from
  for (let count = 0; count < codePoints; count++) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) throw new Error(`column ${codePoints} is outside the line`)
    index += codePoint > 0xffff ? 2 : 1
  }
  return index
}

export function commentAt(file, locator, kind, span, body) {
  const { line, column } = locator.position(span.start)
  return {
    file: file.path,
    kind,
    text: file.text.slice(span.start, span.end),
    body,
    line,
    column,
    span,
  }
}

export function hashKind(line, column, text) {
  return line === 1 && column === 1 && text.startsWith("#!") ? "hashbang" : "hash"
}
