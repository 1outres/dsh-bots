/**
 * The base image release the plugin imports: the one infra/release.env names,
 * or a mirror given in the config with its manifest's sha256 (both or neither).
 */
import type { BotEnvironmentImageRelease, ImageProblem } from "@1outres/dsh-bot-core"
import { IMAGE_TAG, MANIFEST_SHA256 } from "./release-env"

export const RELEASE_REPOSITORY = "1outres/dsh-bots"

export interface ReleaseOverride {
  /** Empty: the GitHub release of {@link IMAGE_TAG}. */
  readonly baseUrl: string
  /** Empty: {@link MANIFEST_SHA256}. */
  readonly manifestSha256: string
}

export type ReleaseChoice =
  | { readonly ok: true; readonly release: BotEnvironmentImageRelease }
  | { readonly ok: false; readonly problem: ImageProblem }

const SHA256 = /^[0-9a-f]{64}$/

export function releaseOf(override: ReleaseOverride): ReleaseChoice {
  const { baseUrl, manifestSha256 } = override
  if ((baseUrl === "") !== (manifestSha256 === "")) {
    return {
      ok: false,
      problem: {
        code: "release-unset",
        message: "imageBaseUrl and imageManifestSha256 must be set together",
        fix: "set both (a mirror of a release and its manifest.txt's sha256), or neither",
      },
    }
  }
  if (baseUrl !== "") {
    if (!SHA256.test(manifestSha256) || !/^https?:\/\//.test(baseUrl)) {
      return {
        ok: false,
        problem: {
          code: "release-unset",
          message: `imageBaseUrl "${baseUrl}" is not an http(s) URL or imageManifestSha256 is not a sha256`,
          fix: "set imageBaseUrl to the URL manifest.txt is under and imageManifestSha256 to its sha256",
        },
      }
    }
    return {
      ok: true,
      release: { tag: IMAGE_TAG, manifestSha256, baseUrl: baseUrl.replace(/\/+$/, "") },
    }
  }
  if (IMAGE_TAG.length === 0 || !SHA256.test(MANIFEST_SHA256)) {
    return {
      ok: false,
      problem: {
        code: "release-unset",
        message: "this version of dsh-bots names no published base image",
        fix: "build one with infra/vm/build-base-image.sh and turn manageImage off, or set imageBaseUrl and imageManifestSha256",
      },
    }
  }
  return {
    ok: true,
    release: {
      tag: IMAGE_TAG,
      manifestSha256: MANIFEST_SHA256,
      baseUrl: `https://github.com/${RELEASE_REPOSITORY}/releases/download/${IMAGE_TAG}`,
    },
  }
}
