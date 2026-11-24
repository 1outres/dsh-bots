import type { BotConnectorToolDefinition } from "@1outres/dsh-bot-core"
import type { AgentParams } from "../agent/protocol"
import { regionToScreen, type ScreenFrame, toModel } from "../frame"
import { checkScreenshot } from "../image"
import type { DesktopSession } from "../session"
import { between, elementId } from "./arguments"
import { argumentFields, type DesktopToolDeps, desktopTool } from "./define"

export const SCREENSHOT_LIMITS = { maxBytes: 12 << 20, maxSide: 8192 } as const
/** A region is enlarged at most this much (and never beyond the screen's width). */
const MAX_ZOOM = 4

export function screenTools(deps: DesktopToolDeps): BotConnectorToolDefinition<DesktopSession>[] {
  return [
    desktopTool(
      {
        name: "screenshot",
        description:
          "Look at the desktop as an image. Prefer desktop_tree/desktop_find (they name what is on screen, with ids to act on); take a screenshot only when the tree cannot tell you (pictures, layout, canvas content, a tree that looks wrong). Coordinates you give desktop_click and the other pointer tools refer to the LATEST screenshot's image. target: 'screen' (default), 'active' (the active window) or an element/window id; or region {x, y, width, height} in the latest screenshot's image to zoom into.",
        parameters: {
          target: {
            type: "string",
            description: "'screen', 'active', or an element or window id.",
          },
          region: {
            type: "object",
            additionalProperties: false,
            description:
              "A rectangle of the latest screenshot's image to enlarge (instead of target).",
            properties: {
              x: { type: "integer", required: true },
              y: { type: "integer", required: true },
              width: { type: "integer", required: true },
              height: { type: "integer", required: true },
            },
          },
          format: { type: "string", enum: ["png", "jpeg"], description: "Default png." },
        },
        kind: "observe",
        preview: (args) => ({
          title: "Take a screenshot of the bot's desktop?",
          fields: argumentFields(args),
        }),
        async run(args, run) {
          const { agent, frames } = run.attachment
          const format = args.format ?? "png"
          let request: AgentParams["screenshot"]
          if (args.region !== undefined) {
            if (args.target !== undefined) throw new Error("give a target or a region, not both")
            const frame = frames.require()
            between("region.width", args.region.width, 1, frame.model.width)
            between("region.height", args.region.height, 1, frame.model.height)
            const region = regionToScreen(frame, args.region)
            request = {
              region,
              width: Math.min(frame.screen.width, region.width * MAX_ZOOM),
              format,
              expect_screen: frame.screen,
            }
          } else {
            const target = args.target ?? "screen"
            request = {
              target:
                target === "screen" || target === "active" ? target : elementId(target, "target"),
              format,
            }
          }
          const caller = run.caller
          if (caller === undefined) {
            throw new Error(
              "a screenshot can only be shown to a calling model; use desktop_tree instead",
            )
          }
          const shot = await agent.call("screenshot", request, run.signal)
          const image = checkScreenshot(shot, SCREENSHOT_LIMITS)
          const [x = 0, y = 0, width = 0, height = 0] = shot.region
          const [screenWidth = 0, screenHeight = 0] = shot.screen
          if (
            width < 1 ||
            height < 1 ||
            x < 0 ||
            y < 0 ||
            x + width > screenWidth ||
            y + height > screenHeight
          ) {
            throw new Error("the desktop agent reported a region outside the screen")
          }
          const admitted = await caller.images.admit({
            mediaType: image.mediaType,
            data: image.data,
            name: `desktop.${format === "png" ? "png" : "jpg"}`,
          })
          if (!admitted.ok) {
            throw new Error(
              `the screenshot cannot be shown: ${admitted.reason}. Use desktop_tree instead.`,
            )
          }
          const frame: ScreenFrame = {
            screen: { width: screenWidth, height: screenHeight },
            region: { x, y, width, height },
            model: { width: admitted.image.width, height: admitted.image.height },
          }
          frames.remember(frame)
          return {
            text: `Screenshot ${frame.model.width}x${frame.model.height} of the screen area ${width}x${height}+${x}+${y}. Pointer coordinates now refer to this image.`,
            data: {
              width: frame.model.width,
              height: frame.model.height,
              region: frame.region,
              screen: frame.screen,
            },
            images: [admitted.image],
          }
        },
      },
      deps,
    ),
    desktopTool(
      {
        name: "cursor_position",
        description:
          "Where the mouse pointer is: in screen pixels, and in the latest screenshot's image when it shows that spot.",
        parameters: {},
        kind: "observe",
        preview: () => ({ title: "Read the pointer position on the bot's desktop?", fields: [] }),
        async run(_args, run) {
          const cursor = await run.attachment.agent.call("cursor", {}, run.signal)
          const frame = run.attachment.frames.current()
          const model = frame === undefined ? undefined : toModel(frame, cursor)
          return {
            data: {
              screen: { x: cursor.x, y: cursor.y },
              screenshot: model === undefined ? null : model,
              screenSize: cursor.screen,
            },
          }
        },
      },
      deps,
    ),
  ]
}
