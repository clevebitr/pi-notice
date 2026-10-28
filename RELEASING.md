# Releasing pi-notice

## Prerequisites

- npm account with a verified email
- access to publish the `pi-notice` package
- 2FA/OTP configured on the account, or a granular token with publish rights
- for CI publishing: repository secret `NPM_TOKEN`

The package pins `publishConfig.registry` to `https://registry.npmjs.org/`, so a
local npm mirror (for example npmmirror) does not receive the publish.

## Local release

```bash
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org

npm run check
npm test
npm publish --dry-run
npm pack --dry-run
```

Bump the version, then publish:

```bash
npm version patch --no-git-tag-version   # or minor / major
git add package.json package-lock.json
git commit -m "chore: release v0.1.1"
git tag v0.1.1
git push origin main --tags

npm publish
```

If 2FA is enabled, append `--otp=123456` or complete the browser prompt.

## GitHub Actions release

1. Add the repository secret `NPM_TOKEN` (npm automation/granular token with
   publish permission for `pi-notice`).
2. Bump `package.json` and push the tag, e.g. `v0.1.1`.
3. Create a GitHub Release from that tag.
4. The `Publish` workflow runs checks and `npm publish --provenance`.

Provenance requires a public repository and the `id-token: write` permission
already set in `.github/workflows/publish.yml`.

## After publishing

```bash
npm view pi-notice --registry=https://registry.npmjs.org
pi install npm:pi-notice@0.1.1
```

Run `/notice test` inside Pi to verify the installed package.
