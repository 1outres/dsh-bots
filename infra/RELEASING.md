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
3. **Tag** a commit of `main`: `git tag v<version> && git push origin v<version>`.
4. **Actions** (`.github/workflows/release.yml`) then:
   - checks that the tag, `DSH_BOTS_VERSION` and every package's `version` are one version and
     that the tagged commit is on `main`;
   - runs CI (`ci.yml`: install with the lockfile, build, typecheck, lint, test, shellcheck, actionlint);
   - checks the image release `IMAGE_TAG`: published, `manifest.txt` with the sha256
     `IMAGE_MANIFEST_SHA256` and DSH `DSH_VERSION`, every part present;
   - packs every package and checks that no `workspace:` range is left and that `@1outres/*`
     dependencies are `<version>` (peers `^<version>`);
   - `pnpm -r publish --access public --provenance` in the environment `npm`, skipping versions
     npm already has and waiting until each is installable before its dependents;
   - creates the GitHub release `v<version>` (marked latest; skipped if it exists).

   Any failed check stops it before npm. If a run fails part-way, fix the cause outside the
   tag (npm, the image, a secret) and use **Re-run failed jobs**: published versions are
   skipped. A fix in the tree needs a new version: npm never takes the same version twice.
5. **Check**: `npm view @1outres/dsh-bots@<version> dependencies`, and on a clean host
   `curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash`.

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
