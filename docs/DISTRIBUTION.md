# Windows installer and updates

`npm run pack:win` builds an unpacked Windows launcher in `release/win-unpacked/`. It is useful for local smoke tests. Installers are built with `npm run dist:win` after an update source is configured.

## GitHub Releases

1. `distribution.json` points to your public `SourCream206/omniNote` repository. Leave `githubPrivate` as `false` and `updateUrl` empty. Installed apps can read releases without a user token.
2. Bump `version` in `package.json` and regenerate `package-lock.json` with `npm install --package-lock-only`. The Git checkpoint labels in `docs/VERSIONS.md` are separate from this packaged app version.
3. Push a matching version tag, such as `v0.0.1` for the current build, then `v0.0.2` for the next. The Windows release workflow runs `npm test` and `npm run dist:win`, then publishes the installer, `latest.yml`, and blockmap together. Inspect the workflow result and release assets before sharing the installer. A draft is not visible to installed apps.
4. Users install the first release once. On later launches, omniNote checks for newer releases. **Install update** appears above Settings when a newer version is found. **Yes** downloads, installs silently, and restarts; **Ignore** hides that version; **Cancel** leaves it available. Settings has a manual **Check for updates** action.

A Git commit or push alone is not an app update. The packaged version must increase and a release with matching installer and metadata must be published. The installed release keeps using the repository configured when that installer was built.

## Generic HTTPS feed

If releases should not be hosted on GitHub, leave `githubRepository` empty and set `updateUrl` to a real HTTPS directory in `distribution.json`. Upload the same installer, `latest.yml`, and blockmap files there. The extension catalog has its own optional `marketplaceUrl` and can be hosted separately; its absence does not block app releases.

The current `distribution.json` points updates at your public GitHub repository and the extension catalog at GitHub Pages. `npm run pack:win` is a local test build and does not prove the complete update flow. The automated installers are currently unsigned, so Windows may show a publisher warning. Sign installers before broader distribution, and verify one version-to-version update with a published test release. The stable app ID and `omniNote` user-data directory keep local notes at the same location across these updates.
