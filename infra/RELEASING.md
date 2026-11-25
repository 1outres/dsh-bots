# Releasing dsh-bots

A release is the npm packages `@1outres/*` of one version plus the base image that
`infra/release.env` names. GitHub Actions publishes the packages; the author builds and
uploads the image, which is too large for Actions (about 1.6 GiB).

The installer reads `release.env` from the **latest GitHub release** (`v<version>`, via
`releases/latest`), not from `main`, and the Release workflow creates that GitHub release only
after npm has the packages and the image checks out. So `main` may name an unpublished version
at any time; a piped install never sees it until its tag is released.

## Flow

1. **Image** (only when it changes: `provision-base.sh`, the desktop connector's
   `debian-packages.txt` or apt source, the browser connector's MCP shrinkwrap, a new DSH),
   on a host set up by `infra/vm/host-setup.sh`, with `gh` signed in:

   ```sh
   infra/vm/build-base-image.sh                 # ~25 min
   infra/vm/export-image.sh image-YYYYMMDD      # dist/image-YYYYMMDD/, sets IMAGE_TAG and IMAGE_MANIFEST_SHA256 in release.env
   infra/vm/publish-image.sh                    # uploads it as the release image-YYYYMMDD (never "latest") and checks it
   ```

   `publish-image.sh` checks every part's sha256 first; run it again if an upload breaks
   off (it finishes the draft). `infra/vm/check-image-release.sh` repeats the check at any time.
   Without an image change, keep `IMAGE_TAG` and `IMAGE_MANIFEST_SHA256` as they are.
2. **Versions**: give every `packages/*/package.json` the new `version`, the peers on
   bot-core `workspace:^<version>`, and `DSH_BOTS_VERSION` in `infra/release.env` the same
   value (for a new DSH also every `engines.dsh` and `DSH_VERSION`). `pnpm build && pnpm
   typecheck && pnpm lint && pnpm test`, then merge to `main`.
3. **Release notes**, in English, before tagging: they are what every dsh-bots Web UI shows
   once it runs the new version (bot-core reads the published `v<version>` releases after the
   version it last showed from the GitHub API and draws their bodies as Markdown; see
   `docs/specs/bot-onboarding.md` §5). Write them as a draft release of the coming tag:

   ```sh
   gh release create v<version> --draft --target main --title "dsh-bots <version>" --notes-file notes.md
   ```

   Write for the people using dsh-bots: what they can do now and what changed for them, as a
   short Markdown list (headings, lists, links, code; no HTML, which is shown as text). The
   Release workflow publishes this draft as it is. Without a draft it creates the release with
   a generated body (the install line and the changelog link), and that is what the Web UI
   shows. A body edited after publishing reaches only the installations that have not
   acknowledged that version yet; a release with an empty body is shown to nobody.
4. **Tag** a commit of `main`: `git tag v<version> && git push origin v<version>`.
5. **Actions** (`.github/workflows/release.yml`) then:
   - checks that the tag, `DSH_BOTS_VERSION` and every package's `version` are one version and
     that the tagged commit is on `main`;
   - runs CI (`ci.yml`: install with the lockfile, build, typecheck, lint, test, shellcheck, actionlint);
   - checks the image release `IMAGE_TAG`: published, `manifest.txt` with the sha256
     `IMAGE_MANIFEST_SHA256` and DSH `DSH_VERSION`, every part present;
   - packs every package and checks that no `workspace:` range is left and that `@1outres/*`
     dependencies are `<version>` (peers `^<version>`);
   - `pnpm -r publish --access public --provenance` in the environment `npm`, skipping versions
     npm already has and waiting until each is installable before its dependents;
   - publishes the author's draft release `v<version>` with its notes, or creates the release
     (marked latest either way; nothing is done if it is published already).

   Any failed check stops it before npm. If a run fails part-way, fix the cause outside the
   tag (npm, the image, a secret) and use **Re-run failed jobs**: published versions are
   skipped. A fix in the tree needs a new version: npm never takes the same version twice.
6. **Check**: `npm view @1outres/dsh-bots@<version> dependencies`, and on a clean host
   `curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash`.

## 1Password CLI

`@1outres/dsh-bot-vault-1password` downloads one pinned 1Password CLI (`packages/dsh-bot-vault-1password/src/cli/release.ts`). To raise it:

1. Pick the version from <https://releases.1password.com/developers/cli/> (stable only).
2. Download `https://cache.agilebits.com/dist/1P/op2/pkg/v<version>/op_<os>_<arch>_v<version>.zip` for `linux_amd64`, `linux_arm64`, `darwin_amd64` and `darwin_arm64` into an empty directory.
3. Verify each: unzip into its own directory and check `op.sig` against `op` with 1Password's key (`gpg --keyserver keyserver.ubuntu.com --receive-keys 3FEF9748469ADBE15DA7CA80AC2D62742012EA22`, then `gpg --verify op.sig op`, "Good signature from 1Password"; the fingerprint must be exactly that one).
4. Put the version and, per platform, `sha256sum` of the zip (`sha256`) and of the verified `op` (`binarySha256`) in `release.ts`, and the version in the test "the pinned release".
5. Check with a real service account (docs/1password.md, "本物のアカウントで確かめる"): the JSON of `op whoami`, `op item get` and the errors' wording may change between versions (`src/op/items.ts`, `src/op/failure.ts`).

On the next start each DSH installs the new version under its data directory and removes the old one.

## One-time setup (author)

### Repository

- The repository and its releases must be public: the installer downloads the source tarball
  and the image without credentials, and npm provenance requires a public repository.
- **Environment** `npm` (Settings → Environments → New environment): under _Deployment
  branches and tags_ choose _Selected branches and tags_ and add the tag pattern `v*`.
  Optionally add yourself as a required reviewer (public repositories) to approve each publish.
- **Tag ruleset** (Settings → Rules → Rulesets → New tag ruleset) targeting `v*` and `image-*`:
  _Restrict creations_, _Restrict updates_ and _Restrict deletions_, with yourself (or the
  admin role) in the bypass list, so nobody else can start a release or move a released tag.
- Optional: enable _Release immutability_ (Settings → General → Releases) so released
  assets and tags cannot change.

### First publish: a token

The packages do not exist on npm yet, and a trusted publisher can only be configured on an
existing package, so the first release uses a token.

1. npmjs.com → profile picture → **Access Tokens** → **Generate New Token** (a granular access token):
   - name, e.g. `dsh-bots first release`; **Expiration**: a few days;
   - **Bypass two-factor authentication**: on (Actions cannot answer an OTP);
   - **Packages and scopes**: _Read and write (publish and stage)_, _Only select packages and
     scopes_, the scope `@1outres` (the packages do not exist yet);
   - no organization access.
2. GitHub → Settings → Environments → `npm` → **Environment secrets** → `NPM_TOKEN` = the token.
3. Release as in the flow above.

npm will end direct publishing with granular tokens in January 2027, so switch to trusted
publishing right after the first release.

### Then: trusted publishing (OIDC), no token

For **each** of the eight packages (npmjs.com → the package → **Settings** → **Trusted
publishing** → GitHub Actions):

- Organization or user: `1outres`; Repository: `dsh-bots`;
- Workflow filename: `release.yml`; Environment name: `npm`;
- Allowed actions: also allow **npm publish** (configurations made after 2026-09-03 allow only
  `npm stage publish` by default; the workflow publishes directly).

A new configuration expires unless a publish uses it within 2 days, so configure it shortly
before the next release. That release is the test: its versions on npmjs.com show
"Published via GitHub Actions" with provenance. Then:

1. Delete the `NPM_TOKEN` secret of the environment `npm`.
2. Revoke the token on npmjs.com (Access Tokens → the token → Delete).
3. For each package: Settings → **Publishing access** → _Require two-factor authentication
   and disallow tokens_ → Update Package Settings.

The workflow needs no change: it always grants `id-token: write` and passes
`NODE_AUTH_TOKEN`; pnpm tries the OIDC exchange first for each package and uses the token only
where no trusted publisher accepts it, and with trusted publishing provenance comes with it.

## Trying it before anything is public

`install.sh` takes a local tree, registry and image:

```sh
# packed packages published to a local registry, e.g. Verdaccio on 127.0.0.1:4873:
#   pnpm build && pnpm -r --filter './packages/*' pack --pack-destination /tmp/pack
#   for f in /tmp/pack/*.tgz; do npm publish "$f" --registry http://127.0.0.1:4873; done
DSH_BOTS_SOURCE=$PWD \
DSH_BOTS_NPM_REGISTRY=http://127.0.0.1:4873 \
DSH_BOTS_IMAGE_URL=file://$PWD/dist/image-YYYYMMDD \
DSH_BOTS_IMAGE_MANIFEST_SHA256=$(sha256sum dist/image-YYYYMMDD/manifest.txt | cut -d' ' -f1) \
  bash install.sh
```

`node scripts/release/check-versions.mjs v<version>` and `node scripts/release/check-packed.mjs`
run the workflow's version and tarball checks locally.
