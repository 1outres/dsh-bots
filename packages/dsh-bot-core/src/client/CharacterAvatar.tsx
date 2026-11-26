import { useId } from "react"
import type { BotCharacter } from "../shared/avatar"
import {
  CHARACTER_SHAPES,
  CHARACTER_VIEW_SIZE,
  type CharacterPaint,
  type CharacterShape,
  characterPalette,
} from "../shared/character-shapes"

type Palette = { readonly [P in CharacterPaint]: string }

function paintProps(shape: CharacterShape, palette: Palette) {
  return {
    fill: shape.fill === undefined ? "none" : palette[shape.fill],
    ...(shape.stroke === undefined
      ? {}
      : {
          stroke: palette[shape.stroke.paint],
          strokeWidth: shape.stroke.width,
          strokeLinecap: "round" as const,
          strokeLinejoin: "round" as const,
        }),
  }
}

function ShapeElement({ shape, palette }: { shape: CharacterShape; palette: Palette }) {
  const paint = paintProps(shape, palette)
  switch (shape.kind) {
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.radius}
          {...paint}
        />
      )
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...paint} />
    case "path":
      return <path d={shape.d} {...paint} />
  }
}

export interface CharacterAvatarProps {
  readonly character: BotCharacter
  readonly color: string
  readonly size: number
}

export function CharacterAvatar({ character, color, size }: CharacterAvatarProps) {
  const clipId = useId()
  const palette = characterPalette(color)
  const half = CHARACTER_VIEW_SIZE / 2
  return (
    <svg
      className="dshb-avatar"
      width={size}
      height={size}
      viewBox={`0 0 ${CHARACTER_VIEW_SIZE} ${CHARACTER_VIEW_SIZE}`}
      aria-hidden="true"
      focusable="false"
      data-dshb-character={character}
    >
      <clipPath id={clipId}>
        <circle cx={half} cy={half} r={half} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect width={CHARACTER_VIEW_SIZE} height={CHARACTER_VIEW_SIZE} fill={color} />
        {CHARACTER_SHAPES[character].map((shape, index) => (
          <ShapeElement key={index} shape={shape} palette={palette} />
        ))}
      </g>
    </svg>
  )
}
