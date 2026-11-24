import { readFile } from "node:fs/promises"

/** Data files a Host entry imports as their text (vitest.config.ts loads them alike). */
export const TEXT_LOADERS = { ".txt": "text" }

/**
 * esbuild options shared by scripts/build.mjs and the repository tests.
 *
 * Host entries (src/index.ts, src/plugins/*.ts) keep every package import
 * external. `@1outres/*` is listed explicitly: the root tsconfig maps those
 * names to packages/<name>/src for type checking, and esbuild follows such
 * paths before `packages: "external"` applies, which would copy another
 * plugin's runtime (and its dependencies) into this one.
 */
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

/** What the browser's module table gives every client bundle; everything else is bundled in. */
export const CLIENT_EXTERNALS = ["react", "react/jsx-runtime", "react-dom", "@1outres/*"]

const NOVNC_H264_PROBE = "supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();"

/**
 * noVNC 1.7's core/util/browser.js awaits its H.264 probe at top level, which
 * a classic-script client bundle cannot hold: the probe resolves later
 * instead (until then H.264 counts as unsupported). The build fails when
 * noVNC no longer has that line.
 */
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

/**
 * esbuild options of a package's src/client/index entry: CommonJS for DSH's
 * client module loader (scripts/build.mjs wraps it), React from the page.
 */
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
