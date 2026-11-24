/**
 * A Playwright MCP result as the connector returns it: its text blocks as
 * the text, its images checked and admitted for the calling model.
 */
import type {
  BotConnectorImage,
  BotConnectorImageInput,
  BotConnectorResult,
  BotConnectorRun,
} from "@1outres/dsh-bot-core"
import type { McpCallResult } from "./mcp/protocol"

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const
type ImageType = (typeof IMAGE_TYPES)[number]
const MAX_IMAGE_BYTES = 16 << 20
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const isImageType = (value: string): value is ImageType =>
  (IMAGE_TYPES as readonly string[]).includes(value)

/** An image block's bytes. @throws for another type, bad base64 or one too large. */
export function imageOf(block: {
  readonly data: string
  readonly mimeType: string
}): BotConnectorImageInput {
  if (!isImageType(block.mimeType)) {
    throw new Error(`Playwright MCP returned an image of type ${block.mimeType.slice(0, 60)}`)
  }
  if (block.data.length % 4 !== 0 || !BASE64.test(block.data)) {
    throw new Error("Playwright MCP returned an image that is not base64")
  }
  if ((block.data.length / 4) * 3 > MAX_IMAGE_BYTES) {
    throw new Error(`Playwright MCP returned an image larger than ${MAX_IMAGE_BYTES} bytes`)
  }
  return { mediaType: block.mimeType, data: new Uint8Array(Buffer.from(block.data, "base64")) }
}

/**
 * @throws with the server's text when it reports an error, and when an image
 *   cannot be shown to the calling model (a run of an approved action has no
 *   caller: its images are left out and said to be).
 */
export async function resultOf(
  result: McpCallResult,
  run: Pick<BotConnectorRun<unknown>, "caller">,
): Promise<BotConnectorResult> {
  const texts: string[] = []
  const images: BotConnectorImage[] = []
  for (const block of result.content) {
    if (block.type === "text") {
      texts.push(block.text)
      continue
    }
    const image = imageOf(block)
    if (result.isError) continue
    if (run.caller === undefined) {
      texts.push("[An image was left out: an approved action's result carries text only.]")
      continue
    }
    const admitted = await run.caller.images.admit(image)
    if (!admitted.ok) throw new Error(`cannot show the image: ${admitted.reason}`)
    images.push(admitted.image)
  }
  const text = texts.join("\n\n")
  if (result.isError) throw new Error(text === "" ? "Playwright MCP reported an error" : text)
  return { ...(text === "" ? {} : { text }), ...(images.length === 0 ? {} : { images }) }
}
