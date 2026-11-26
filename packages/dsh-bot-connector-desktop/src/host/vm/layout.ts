export const DISPLAY = ":1"
export const LIB_DIR = "/usr/local/lib/dsh-desktop"
export const AGENT_DIR = `${LIB_DIR}/agent`
export const DISPLAY_ENV_FILE = "/etc/dsh-desktop/display.env"
export const XVNC_START = `${LIB_DIR}/xvnc-start`
export const CHROME_RUN = `${LIB_DIR}/chrome-run`
export const USER_UNIT_DIR = "/etc/systemd/user"
export const CHROME_POLICY = "/etc/opt/chrome/policies/managed/dsh-desktop.json"

export const UNITS = {
  xvnc: "dsh-desktop-xvnc.service",
  session: "dsh-desktop-session.service",
  agent: "dsh-desktop-agent.service",
  im: "dsh-desktop-im.service",
  chrome: "dsh-desktop-chrome.service",
} as const

export const ENABLED_UNITS = [UNITS.session, UNITS.agent, UNITS.im, UNITS.chrome] as const
export const ALL_UNITS = [UNITS.chrome, UNITS.agent, UNITS.im, UNITS.session, UNITS.xvnc] as const

export const RESTARTED_BY: Readonly<Record<string, readonly string[]>> = {
  [UNITS.xvnc]: [XVNC_START],
  [UNITS.chrome]: [CHROME_RUN, `${USER_UNIT_DIR}/${UNITS.chrome}`],
}

export const DIVERTED_FILES = ["/usr/bin/google-chrome-stable"] as const

export interface VmUser {
  readonly uid: number
  readonly name: string
  readonly home: string
}

export const runtimeDir = (user: VmUser) => `/run/user/${user.uid}`
export const agentSocket = (user: VmUser) => `${runtimeDir(user)}/dsh-desktop-agent/agent.sock`
export const xauthority = (user: VmUser) => `${runtimeDir(user)}/dsh-desktop/Xauthority`
export const vncSocket = (user: VmUser) => `${runtimeDir(user)}/dsh-desktop/vnc.sock`
export const stagingDir = (user: VmUser) => `${user.home}/.cache/dsh-desktop/staging`

export const userManagerEnv = (user: VmUser): Readonly<Record<string, string>> => ({
  XDG_RUNTIME_DIR: runtimeDir(user),
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtimeDir(user)}/bus`,
})

export const displayEnv = (user: VmUser): Readonly<Record<string, string>> => ({
  DISPLAY,
  XAUTHORITY: xauthority(user),
})
