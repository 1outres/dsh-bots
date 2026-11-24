/**
 * Where the desktop lives in the bot's environment: its files, its user
 * services, and the bot user's runtime paths (sockets, the X cookie).
 */
export const DISPLAY = ":1"
export const LIB_DIR = "/usr/local/lib/dsh-desktop"
export const AGENT_DIR = `${LIB_DIR}/agent`
export const DISPLAY_ENV_FILE = "/etc/dsh-desktop/display.env"
export const XVNC_START = `${LIB_DIR}/xvnc-start`
/** How the desktop's Chrome starts (its profile, DevTools on 127.0.0.1:9222, accessibility). */
export const CHROME_RUN = `${LIB_DIR}/chrome-run`
export const USER_UNIT_DIR = "/etc/systemd/user"

export const UNITS = {
  xvnc: "dsh-desktop-xvnc.service",
  session: "dsh-desktop-session.service",
  agent: "dsh-desktop-agent.service",
  im: "dsh-desktop-im.service",
  chrome: "dsh-desktop-chrome.service",
} as const

/** The units enabled at the user manager's start (the X server comes with the session). */
export const ENABLED_UNITS = [UNITS.session, UNITS.agent, UNITS.im, UNITS.chrome] as const
export const ALL_UNITS = [UNITS.chrome, UNITS.agent, UNITS.im, UNITS.session, UNITS.xvnc] as const

/** Running units restarted when one of these installed files changed (the way they start). */
export const RESTARTED_BY: Readonly<Record<string, readonly string[]>> = {
  [UNITS.xvnc]: [XVNC_START],
  [UNITS.chrome]: [CHROME_RUN, `${USER_UNIT_DIR}/${UNITS.chrome}`],
}

/**
 * Files of Debian packages the desktop replaces with its own (dpkg-divert
 * keeps the package's beside them as `<path>.dsh-real`): every way of
 * starting Chrome opens in the desktop's one Chrome.
 */
export const DIVERTED_FILES = ["/usr/bin/google-chrome-stable"] as const

/** The bot's account in its environment. */
export interface VmUser {
  readonly uid: number
  readonly name: string
  readonly home: string
}

export const runtimeDir = (user: VmUser) => `/run/user/${user.uid}`
export const agentSocket = (user: VmUser) => `${runtimeDir(user)}/dsh-desktop-agent/agent.sock`
export const xauthority = (user: VmUser) => `${runtimeDir(user)}/dsh-desktop/Xauthority`
/** Xvnc's RFB socket (`-rfbunixpath`). */
export const vncSocket = (user: VmUser) => `${runtimeDir(user)}/dsh-desktop/vnc.sock`
export const stagingDir = (user: VmUser) => `${user.home}/.cache/dsh-desktop/staging`

/** What `systemctl --user` needs to reach the bot's user manager. */
export const userManagerEnv = (user: VmUser): Readonly<Record<string, string>> => ({
  XDG_RUNTIME_DIR: runtimeDir(user),
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir(user)}/bus`,
})

/** What an X client needs to reach the bot's display. */
export const displayEnv = (user: VmUser): Readonly<Record<string, string>> => ({
  DISPLAY,
  XAUTHORITY: xauthority(user),
})
