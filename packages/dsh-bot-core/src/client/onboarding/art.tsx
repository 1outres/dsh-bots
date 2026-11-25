import type { ReactNode } from "react"
import type { WizardStep } from "./steps"

/** The welcome guide's pictures, one per page; every colour comes from the theme through `dshb-art-*` classes. */
export type ArtKind = WizardStep

function Bot({ x, y, r, tone }: { x: number; y: number; r: number; tone: "a" | "b" | "c" }) {
  return (
    <g className="dshb-art-bot" data-tone={tone}>
      <circle cx={x} cy={y} r={r} className="dshb-art-fill" />
      <circle cx={x - r * 0.32} cy={y - r * 0.08} r={r * 0.13} className="dshb-art-eye" />
      <circle cx={x + r * 0.32} cy={y - r * 0.08} r={r * 0.13} className="dshb-art-eye" />
      <path
        d={`M${x - r * 0.3} ${y + r * 0.3} Q${x} ${y + r * 0.52} ${x + r * 0.3} ${y + r * 0.3}`}
        className="dshb-art-smile"
      />
    </g>
  )
}

function Card({
  x,
  y,
  w,
  h,
  children,
}: {
  x: number
  y: number
  w: number
  h: number
  children?: ReactNode
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} className="dshb-art-card" />
      {children}
    </g>
  )
}

function Sparkle({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <path
      className="dshb-art-sparkle"
      d={`M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z`}
    />
  )
}

const Lines = ({ x, y, widths }: { x: number; y: number; widths: readonly number[] }) => (
  <>
    {widths.map((w, i) => (
      <rect key={i} x={x} y={y + i * 12} width={w} height={6} rx={3} className="dshb-art-text" />
    ))}
  </>
)

function Welcome() {
  return (
    <>
      <circle cx={160} cy={120} r={92} className="dshb-art-halo" />
      <Card x={70} y={70} w={180} h={104}>
        <Lines x={124} y={92} widths={[96, 70]} />
        <rect x={86} y={130} width={148} height={28} rx={14} className="dshb-art-bubble" />
        <Lines x={100} y={141} widths={[88]} />
      </Card>
      <Bot x={98} y={98} r={18} tone="a" />
      <Bot x={232} y={60} r={14} tone="b" />
      <Bot x={258} y={186} r={12} tone="c" />
      <Sparkle x={72} y={196} s={8} />
      <Sparkle x={270} y={110} s={6} />
      <Sparkle x={52} y={60} s={5} />
    </>
  )
}

function Web() {
  return (
    <>
      <circle cx={160} cy={120} r={92} className="dshb-art-halo" />
      <circle cx={146} cy={112} r={52} className="dshb-art-node" />
      <path
        className="dshb-art-glyph dshb-art-wide"
        d="M94 112h104M146 60q-30 52 0 104q30 -52 0 -104M104 84h84M104 140h84"
      />
      <circle cx={196} cy={160} r={22} className="dshb-art-ring" />
      <path className="dshb-art-hand" d="M212 176l22 22" />
    </>
  )
}

function Accounts() {
  return (
    <>
      <circle cx={160} cy={120} r={92} className="dshb-art-halo" />
      <path
        className="dshb-art-shield"
        d="M160 48l62 22v46c0 40-28 66-62 78c-34-12-62-38-62-78V70z"
      />
      <circle cx={146} cy={118} r={16} className="dshb-art-ring" />
      <path className="dshb-art-hand" d="M160 118h34M184 118v12M194 118v8" />
    </>
  )
}

function NewBot() {
  return (
    <>
      <circle cx={160} cy={120} r={92} className="dshb-art-halo" />
      <circle cx={160} cy={116} r={56} className="dshb-art-ring" />
      <Bot x={160} y={116} r={42} tone="a" />
      <circle cx={204} cy={160} r={18} className="dshb-art-plus-bg" />
      <path className="dshb-art-plus" d="M204 151v18M195 160h18" />
      <Sparkle x={96} y={70} s={8} />
      <Sparkle x={232} y={74} s={6} />
    </>
  )
}

function Channels() {
  return (
    <>
      <circle cx={160} cy={120} r={92} className="dshb-art-halo" />
      <g className="dshb-art-float">
        <rect x={74} y={66} width={120} height={54} rx={18} className="dshb-art-card" />
        <Lines x={92} y={84} widths={[84, 56]} />
        <path className="dshb-art-tail" d="M96 118l-6 16l20-14z" />
      </g>
      <g className="dshb-art-float" style={{ animationDelay: "0.5s" }}>
        <rect x={136} y={136} width={112} height={44} rx={16} className="dshb-art-bubble-strong" />
        <Lines x={152} y={152} widths={[70]} />
      </g>
      <Bot x={236} y={96} r={22} tone="a" />
      <Sparkle x={262} y={60} s={7} />
      <Sparkle x={70} y={176} s={6} />
    </>
  )
}

const ART: { readonly [Kind in ArtKind]: () => ReactNode } = {
  welcome: Welcome,
  web: Web,
  accounts: Accounts,
  channels: Channels,
  bot: NewBot,
}

/** The welcome page's features, each a small glyph drawn with the current colour. */
export type FeatureKind = "bots" | "vm" | "main" | "google"

const FEATURE_PATHS: { readonly [Kind in FeatureKind]: string } = {
  bots: "M7 9.5a3 3 0 1 0 0-.01M17 9.5a3 3 0 1 0 0-.01M2.5 19c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4M12.5 19c.6-2.6 2.4-4 4.5-4s3.9 1.4 4.5 4",
  vm: "M3.5 5h17v11h-17zM8.5 20h7M12 16v4M7 9h4M7 12h7",
  main: "M4 6.5h16v9.5h-9l-4.5 3.5v-3.5h-2.5zM8 10.5h8M8 13h5",
  google: "M3.5 6h11v9h-11zM3.5 6l5.5 4.5 5.5-4.5M16 9.5h4.5v10h-9v-2.5M16 12.5h4.5",
}

export function FeatureIcon({ kind }: { readonly kind: FeatureKind }) {
  return (
    <svg
      className="dshb-feature-glyph"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
    >
      <path d={FEATURE_PATHS[kind]} />
    </svg>
  )
}

export function OnboardingArt({ kind }: { readonly kind: ArtKind }) {
  const Picture = ART[kind]
  return (
    <svg className="dshb-art" viewBox="0 0 320 240" aria-hidden="true" data-dshb-art={kind}>
      <Picture />
    </svg>
  )
}
