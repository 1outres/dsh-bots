import type { BotAvatar } from "../shared/avatar"
import { CharacterAvatar } from "./CharacterAvatar"

export function Avatar({ avatar, size }: { avatar: BotAvatar; size: number }) {
  switch (avatar.kind) {
    case "image":
      return (
        <img
          className="dshb-avatar"
          src={avatar.dataUrl}
          width={size}
          height={size}
          alt=""
          draggable={false}
        />
      )
    case "initial":
      return (
        <span
          className="dshb-avatar"
          style={{
            width: size,
            height: size,
            background: avatar.color,
            color: "#fff",
            fontSize: size * 0.5,
            fontWeight: 600,
          }}
          aria-hidden="true"
        >
          {avatar.text}
        </span>
      )
    case "character":
      return <CharacterAvatar character={avatar.character} color={avatar.color} size={size} />
  }
}
