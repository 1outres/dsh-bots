import type { Resolution } from "../../shared/resolution"
import {
  AGENT_DIR,
  CHROME_POLICY,
  CHROME_RUN,
  DISPLAY_ENV_FILE,
  LIB_DIR,
  USER_UNIT_DIR,
  XVNC_START,
} from "./layout"

export interface VmSourceFile {
  readonly path: string
  readonly data: Uint8Array
}

export interface InstalledFile {
  readonly target: string
  readonly mode: number
  readonly data: Uint8Array
}

interface Placement {
  readonly from: string
  readonly to: string
  readonly mode: number
}

const PLACEMENTS: readonly Placement[] = [
  { from: "agent/run.py", to: `${AGENT_DIR}/run.py`, mode: 0o644 },
  { from: "agent/dsh_desktop_agent/", to: `${AGENT_DIR}/dsh_desktop_agent/`, mode: 0o644 },
  { from: "bin/xvnc-start", to: XVNC_START, mode: 0o755 },
  { from: "bin/chrome-run", to: CHROME_RUN, mode: 0o755 },
  { from: "bin/chrome-ready", to: `${LIB_DIR}/chrome-ready`, mode: 0o755 },
  { from: "bin/google-chrome-stable", to: "/usr/bin/google-chrome-stable", mode: 0o755 },
  { from: "systemd/", to: `${USER_UNIT_DIR}/`, mode: 0o644 },
  { from: "apt/google-chrome.asc", to: "/etc/apt/keyrings/dsh-google-chrome.asc", mode: 0o644 },
  {
    from: "apt/google-chrome.sources",
    to: "/etc/apt/sources.list.d/dsh-google-chrome.sources",
    mode: 0o644,
  },
  { from: "config/fcitx5-profile", to: "/etc/xdg/fcitx5/profile", mode: 0o644 },
  { from: "config/chrome-policy.json", to: CHROME_POLICY, mode: 0o644 },
  {
    from: "config/libreoffice.xcd",
    to: "/usr/lib/libreoffice/share/registry/dsh-desktop.xcd",
    mode: 0o644,
  },
]

export function placementOf(path: string): { readonly target: string; readonly mode: number } {
  for (const placement of PLACEMENTS) {
    if (placement.from.endsWith("/")) {
      const rest = path.startsWith(placement.from) ? path.slice(placement.from.length) : undefined
      if (rest !== undefined && rest !== "" && !rest.includes("/")) {
        return { target: placement.to + rest, mode: placement.mode }
      }
    } else if (placement.from === path) {
      return { target: placement.to, mode: placement.mode }
    }
  }
  throw new Error(`vm/${path} has no place in the bot's environment`)
}

export function displaySettings(resolution: Resolution): string {
  return `DSH_DESKTOP_GEOMETRY=${resolution.width}x${resolution.height}\n`
}

export function installedFiles(
  sources: readonly VmSourceFile[],
  resolution: Resolution,
): readonly InstalledFile[] {
  return [
    ...sources.map((source) => ({ ...placementOf(source.path), data: source.data })),
    {
      target: DISPLAY_ENV_FILE,
      mode: 0o644,
      data: new TextEncoder().encode(displaySettings(resolution)),
    },
  ]
}

export const REPLACED_DIRECTORIES = [AGENT_DIR] as const
