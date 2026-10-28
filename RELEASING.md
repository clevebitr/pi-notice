# Releasing pi-notice

This package uses **npm Trusted Publisher (OIDC)** for releases. No long-lived
`NPM_TOKEN` is required after the one-time bootstrap.

## One-time bootstrap: publish 0.1.0 manually

npm cannot attach a trusted publisher until the package exists on the registry.
The first version must be published manually (2FA/OTP) or with a temporary
token. `0.1.0` is published; `0.2.0` added TUI subcommands, `0.3.0` adds the
settings panel, i18n (en / zh-CN / zh-TW), and the localization page.

```bash
cd F:/Projetcs/pi-notice

npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org

npm run check
npm test
npm publish --dry-run
npm publish
```

If 2FA is enabled, npm asks for the one-time password or prints a browser
authentication URL.

## Configure the trusted publisher on npm

After `0.1.0` exists on npmjs.com:

1. Open `https://www.npmjs.com/package/pi-notice`
2. Go to **Settings** → **Trusted Publisher**
3. Choose **GitHub Actions**
4. Fill in exactly:

   | Field | Value |
   | --- | --- |
   | Organization or user | `clevebitr` |
   | Repository | `pi-notice` |
   | Workflow filename | `publish.yml` |
   | Environment name | leave blank |
   | Allowed actions | check **npm publish** |

5. Save.

Alternatively, use the npm CLI (npm 11.15+):

```bash
npm trust github pi-notice   --file publish.yml   --repo clevebitr/pi-notice   --allow-publish
npm trust list pi-notice
```

The workflow filename must be exactly `publish.yml` (not the full path). The
`repository.url` in `package.json` must match the GitHub repository; it is
already set to `git+https://github.com/clevebitr/pi-notice.git`.

A new trusted-publisher configuration must complete its first successful publish
within 2 days, otherwise npm expires it. Create the configuration when you are
ready to tag the next release.

If you set an **Environment name** on npm, add the same name to the publish job:

```yaml
jobs:
  npm:
    runs-on: ubuntu-latest
    environment: <environment-name>
```

## Publish a new version

1. Bump the version and lockfile:

   ```bash
   npm version patch --no-git-tag-version
   ```

   Use `minor` or `major` when appropriate.

2. Commit and tag:

   ```bash
   git add package.json package-lock.json
   git commit -m "chore: release v0.1.1"
   git tag v0.1.1
   git push origin main --tags
   ```

3. The `Publish` workflow runs on the `v*` tag:

   - checks that the tag matches `package.json`
   - runs `npm ci`, `npm run check`, `npm test`
   - runs `npm publish` with OIDC authentication
   - npm generates provenance automatically

No `NPM_TOKEN` secret is needed. If an old `NPM_TOKEN` secret exists in the
repository, it can be removed after trusted publishing is verified.

You can also run the workflow manually from **Actions → Publish → Run workflow**.
Manual runs publish the version currently in `package.json` on the selected
branch; the tag/version check only runs for tag pushes.

## Verify

```bash
npm view pi-notice --registry=https://registry.npmjs.org
pi install npm:pi-notice@0.1.1
```

Run `/notice test` inside Pi to verify the installed package.

## Troubleshooting

- **`ENEEDAUTH` / 404 on publish**: the npm trusted-publisher workflow filename,
  repository, or owner does not match. All fields are case-sensitive.
- **`EOTP`**: trusted publishing is not configured yet, or a manual publish was
  attempted without an OTP.
- **`repository.url` mismatch**: update `package.json` so the URL points at the
  GitHub repository that owns the workflow.
- **Version already exists**: bump `package.json` and create a new tag; npm
  versions are immutable.
- **Self-hosted runners**: npm trusted publishing currently requires
  GitHub-hosted runners.
