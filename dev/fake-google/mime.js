function unfold(text) {
  return text.replace(/\r\n[ \t]+/g, " ")
}

export function decodeWords(value) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=/gi, (_, data) =>
      Buffer.from(data, "base64").toString("utf8"),
    )
}

function headersOf(block) {
  const headers = new Map()
  for (const line of unfold(block).split("\r\n")) {
    const at = line.indexOf(":")
    if (at <= 0) continue
    headers.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim())
  }
  return headers
}

function split(text) {
  const at = text.indexOf("\r\n\r\n")
  return at < 0 ? { head: text, body: "" } : { head: text.slice(0, at), body: text.slice(at + 4) }
}

function decodeBody(headers, body) {
  const encoding = (headers.get("content-transfer-encoding") ?? "").toLowerCase()
  if (encoding === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64")
  return Buffer.from(body, "utf8")
}

function parameter(value, name) {
  const extended = new RegExp(`${name}\\*=UTF-8''([^;]+)`, "i").exec(value)
  if (extended) return decodeURIComponent(extended[1])
  const plain =
    new RegExp(`${name}="([^"]*)"`, "i").exec(value) ??
    new RegExp(`${name}=([^;\\s]+)`, "i").exec(value)
  return plain === null ? undefined : decodeWords(plain[1])
}

export function parseMime(raw) {
  const { head, body } = split(raw)
  const headers = headersOf(head)
  const decoded = Object.fromEntries([...headers].map(([key, value]) => [key, decodeWords(value)]))
  const type = headers.get("content-type") ?? "text/plain"
  const boundary = parameter(type, "boundary")
  if (!/^multipart\//i.test(type) || boundary === undefined) {
    return {
      headers: decoded,
      text: decodeBody(headers, body).toString("utf8").replace(/\r\n/g, "\n"),
      attachments: [],
    }
  }
  let text = ""
  const attachments = []
  const parts = body.split(`--${boundary}`).slice(1)
  for (const part of parts) {
    if (part.startsWith("--")) break
    const { head: partHead, body: partBody } = split(part.replace(/^\r\n/, "").replace(/\r\n$/, ""))
    const partHeaders = headersOf(partHead)
    const partType = partHeaders.get("content-type") ?? "text/plain"
    const disposition = partHeaders.get("content-disposition") ?? ""
    const data = decodeBody(partHeaders, partBody)
    if (/^attachment/i.test(disposition)) {
      attachments.push({
        filename: parameter(disposition, "filename") ?? parameter(partType, "name") ?? "attachment",
        mimeType: partType.split(";")[0].trim(),
        data,
      })
    } else if (/^text\/plain/i.test(partType) && text === "") {
      text = data.toString("utf8").replace(/\r\n/g, "\n")
    }
  }
  return { headers: decoded, text, attachments }
}
