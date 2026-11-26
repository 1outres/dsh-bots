import { readFile } from "node:fs/promises"

export const TEXT_LOADERS = { ".txt": "text" }

export function hostBuildOptions(entry, outfile) {
  return {
    entryPoints: [entry],
    outfile,
    bundle: true,
    packages: "external",
    external: ["@1outres/*"],
    loader: TEXT_LOADERS,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    logLevel: "warning",
  }
}

export const CLIENT_EXTERNALS = ["react", "react/jsx-runtime", "react-dom", "@1outres/*"]

const NOVNC_H264_PROBE = "supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();"

export const deferNovncH264Probe = {
  name: "defer-novnc-h264-probe",
  setup(api) {
    api.onLoad({ filter: /@novnc[\\/]novnc[\\/]core[\\/]util[\\/]browser\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8")
      if (!source.includes(NOVNC_H264_PROBE)) {
        throw new Error(
          `${args.path}: noVNC's H.264 probe line changed; update deferNovncH264Probe`,
        )
      }
      return {
        contents: source.replace(
          NOVNC_H264_PROBE,
          "_checkWebCodecsH264DecodeSupport().then((supported) => { supportsWebCodecsH264Decode = supported; });",
        ),
        loader: "js",
      }
    })
  },
}

export function clientBuildOptions(entry) {
  return {
    entryPoints: [entry],
    bundle: true,
    external: CLIENT_EXTERNALS,
    format: "cjs",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    logLevel: "warning",
    write: false,
    plugins: [deferNovncH264Probe],
  }
}
