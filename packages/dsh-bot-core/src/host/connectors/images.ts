/**
 * Images of a connector call's result, for the calling model: stored in
 * DSH's attachment store (never in the action ledger), the way dsh-cua and
 * dsh-mcp-client store tool images. Only a model that declares image input
 * gets them; the size reported back is the one that model is sent.
 */
import type {
  BotConnectorImage,
  BotConnectorImageAdmission,
  BotConnectorImageInput,
  BotConnectorImages,
} from "../../connector-contract"

/** dsh-attachment's `ImageAttachmentRef`, as it travels in a tool result. */
export interface ImageRef {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
  readonly originalDimensions?: { readonly width: number; readonly height: number }
}

/** DSH's `attachments` and `llm` services, as images are admitted with them. */
export interface ImageServices {
  readonly attachments: {
    saveImages(inputs: readonly BotConnectorImageInput[]): Promise<readonly ImageRef[]>
    readImageRequest(
      ref: ImageRef,
      target: unknown,
      signal?: AbortSignal,
    ): Promise<{ readonly width: number; readonly height: number }>
  }
  readonly llm: {
    resolveModelInfo(
      provider: string,
      model: string,
      signal?: AbortSignal,
    ): Promise<{ readonly inputModalities?: readonly string[] }>
    imageRequestTarget(provider: string, model: string, ref: ImageRef): unknown
  }
}

export interface ImageAdmissionDeps {
  /** DSH's services, while both are there. */
  services(): ImageServices | undefined
  /** The model the session's Agent runs now. */
  route(sessionId: string): { readonly provider: string; readonly model: string } | undefined
  newId(): string
}

/** The images of one call: what the connector admits, and their stored references. */
export interface RunImages {
  readonly images: BotConnectorImages
  /** @throws for an image not admitted in this run. */
  refs(images: readonly BotConnectorImage[]): readonly ImageRef[]
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createRunImages(
  deps: ImageAdmissionDeps,
  sessionId: string,
  signal: AbortSignal,
): RunImages {
  const admitted = new Map<string, { readonly image: BotConnectorImage; readonly ref: ImageRef }>()
  const refuse = (reason: string): BotConnectorImageAdmission => ({ ok: false, reason })
  return {
    images: {
      async admit(input) {
        const services = deps.services()
        if (services === undefined) return refuse("DSH's attachment store is not available")
        const route = deps.route(sessionId)
        if (route === undefined) return refuse("the calling model could not be resolved")
        try {
          const info = await services.llm.resolveModelInfo(route.provider, route.model, signal)
          if (!info.inputModalities?.includes("image")) {
            return refuse(`the model "${route.model}" does not take images`)
          }
          signal.throwIfAborted()
          const [ref] = await services.attachments.saveImages([input])
          if (ref === undefined) return refuse("the attachment store stored nothing")
          const target = services.llm.imageRequestTarget(route.provider, route.model, ref)
          const sent = await services.attachments.readImageRequest(ref, target, signal)
          const source = ref.originalDimensions ?? { width: ref.width, height: ref.height }
          const image: BotConnectorImage = {
            id: deps.newId(),
            width: sent.width,
            height: sent.height,
            source: { width: source.width, height: source.height },
          }
          admitted.set(image.id, { image, ref })
          return { ok: true, image }
        } catch (error) {
          signal.throwIfAborted()
          return refuse(`the image was not admitted: ${messageOf(error)}`)
        }
      },
    },
    refs(images) {
      return images.map((image) => {
        const entry = admitted.get(image?.id)
        if (entry === undefined)
          throw new Error("the result holds an image not admitted in this run")
        return entry.ref
      })
    },
  }
}
