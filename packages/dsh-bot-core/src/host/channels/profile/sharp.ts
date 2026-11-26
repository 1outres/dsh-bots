import type { AvatarRasterizer, AvatarSource } from "./render"

type SharpModule = typeof import("sharp")
type SharpFactory = SharpModule["default"]

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function inputOf(source: AvatarSource): Buffer {
  if (source.kind === "svg") return Buffer.from(source.svg, "utf8")
  const comma = source.dataUrl.indexOf(",")
  if (comma === -1) throw new Error("the avatar image is not a data URL")
  return Buffer.from(source.dataUrl.slice(comma + 1), "base64")
}

export function createSharpRasterizer(): AvatarRasterizer {
  let loading: Promise<SharpFactory> | undefined
  const load = () => {
    loading ??= import("sharp").then(
      (module) => module.default,
      (error: unknown) => {
        loading = undefined
        throw new Error(`the image library (sharp) could not be loaded: ${messageOf(error)}`)
      },
    )
    return loading
  }
  return {
    async png(source, size) {
      const sharp = await load()
      const png = await sharp(inputOf(source), { animated: false })
        .resize(size, size, { fit: "cover" })
        .png()
        .toBuffer()
      return new Uint8Array(png.buffer, png.byteOffset, png.byteLength)
    },
  }
}
