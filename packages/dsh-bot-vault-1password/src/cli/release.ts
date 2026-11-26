export interface OpArchive {
  readonly os: "linux" | "darwin"
  readonly arch: "amd64" | "arm64"
  readonly sha256: string
  readonly binarySha256: string
}

export interface OpRelease {
  readonly version: string
  readonly archives: Readonly<Record<string, OpArchive>>
}

export const OP_RELEASE: OpRelease = {
  version: "2.42.0",
  archives: {
    "linux-x64": {
      os: "linux",
      arch: "amd64",
      sha256: "261fe3844a43e7e83a3d85e8a9f36411729436a1d3add1dc7dd46cbbceebe9e5",
      binarySha256: "8585aa02644f71c05b268125d0b474fd0d8ed606176b3878517cb79d280cfc92",
    },
    "linux-arm64": {
      os: "linux",
      arch: "arm64",
      sha256: "e56c379fabafb393ce699258e484694abe464870fb41f35ce1b5c3f17868ba61",
      binarySha256: "920ea15771e07ec2afeeb4b1f0ebd1b9cd0f6477a12b6dd892ebd994105baa74",
    },
    "darwin-x64": {
      os: "darwin",
      arch: "amd64",
      sha256: "917b0d2b41de3d943bb6562331275c43c4b525af6b003eade06248905ddd62b0",
      binarySha256: "2e04e530437e3ca3ec0d179804528488ada5966eeadcd51f33f778662ef4213c",
    },
    "darwin-arm64": {
      os: "darwin",
      arch: "arm64",
      sha256: "216e86c6db491c752ccb7819b3b1851cc8456ea015a1f7c8a58dd103ef0a474e",
      binarySha256: "75cb46170a090c6382ce77f4f65012a822635ce01b0bad9c003cd504180f05f8",
    },
  },
}

export const OP_DOWNLOAD_BASE = "https://cache.agilebits.com/dist/1P/op2/pkg"

export function opArchiveUrl(version: string, archive: OpArchive): string {
  const name = `op_${archive.os}_${archive.arch}_v${version}.zip`
  return `${OP_DOWNLOAD_BASE}/v${version}/${name}`
}
