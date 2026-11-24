import type { BotAvatar } from "../shared/bots"

export function Avatar({ avatar, size }: { avatar: BotAvatar; size: number }) {
  if (avatar.kind === "image") {
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
  }
  if (avatar.kind === "initial") {
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
  }
  return (
    <span
      className="dshb-avatar"
      style={{ width: size, height: size, background: avatar.color, fontSize: size * 0.6 }}
      aria-hidden="true"
    >
      {avatar.emoji}
    </span>
  )
}
