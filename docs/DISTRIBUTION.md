# Desktop installers and updates

`npm run pack:win` builds an unpacked Windows launcher in `release/win-unpacked/`. It is useful for local smoke tests. The Windows installer is built with `npm run dist:win`. On Linux, `npm run dist:linux` builds one x86_64 AppImage that runs on most desktop Linux distributions without an installation step. The AppImage is not a package for every architecture or distribution; ARM and environments without compatible desktop libraries are not covered yet.

## GitHub Releases

1. `distribution.json` points to your public `SourCream206/omniNote` repository. Leave `githubPrivate` as `false` and `updateUrl` empty. Installed apps can read releases without a user token.
2. Bump `version` in `package.json` and regenerate `package-lock.json` with `npm install --package-lock-only`. The Git checkpoint labels in `docs/VERSIONS.md` are separate from this packaged app version.
3. Push a matching version tag, such as `v0.0.1` for the current build, then `v0.0.2` for the next. The release workflow builds and tests on Windows and Linux, then publishes the Windows installer, Linux AppImage, `latest.yml`, `latest-linux.yml`, and Windows blockmap together. Inspect both workflow jobs and release assets before sharing the downloads. A draft is not visible to installed apps.
4. Users install the first release once. On later launches, omniNote checks for newer releases. **Install update** appears above Settings when a newer version is found. **Yes** downloads, installs, and restarts; **Ignore** hides that version; **Cancel** leaves it available. Settings has a manual **Check for updates** action. Linux updates apply to the AppImage; keep the downloaded file in a writable location.

A Git commit or push alone is not an app update. The packaged version must increase and a release with matching installer and metadata must be published. The installed release keeps using the repository configured when that installer was built.

## Generic HTTPS feed

If releases should not be hosted on GitHub, leave `githubRepository` empty and set `updateUrl` to a real HTTPS directory in `distribution.json`. Upload the installers, platform update manifests, and blockmap files there. The extension catalog has its own optional `marketplaceUrl` and can be hosted separately; its absence does not block app releases.

The current `distribution.json` points updates at your public GitHub repository and the extension catalog at GitHub Pages. An installed Windows 0.0.3 client detected 0.0.4, installed it without a second wizard step, and kept a test note in an isolated workspace. Linux packaging and update installation still need a smoke test on a Linux desktop before the first Linux release. `npm run pack:win` remains a local test build without update metadata. The automated Windows installers are currently unsigned, so Windows may show a publisher warning; sign them before broader distribution. The stable app ID and `omniNote` user-data directory keep local notes at the same location across updates.
