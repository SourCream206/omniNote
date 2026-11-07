# Desktop installers and updates

The Tauri 2 app uses signed updater artifacts. The in-app updater reads `latest.json` from the latest published GitHub release, verifies the downloaded installer with the public key bundled into the app, then installs it. A commit or push to `main` alone does not create an app update.

## First Tauri release

1. Keep the private signing key at `tauri-v2/.tools/omninote-updater.key` outside Git. Back it up securely. Losing it prevents existing installs from accepting future updates signed with a replacement key.
2. Keep the repository Actions secret `TAURI_SIGNING_PRIVATE_KEY` set to the **contents** of that private key. The public key is in `tauri-v2/src-tauri/tauri.conf.json`.
3. Increase the version in `tauri-v2/src-tauri/tauri.conf.json` and `tauri-v2/src-tauri/Cargo.toml` together. Push the completed changes and a matching `vX.Y.Z` tag only when the Tauri app is ready for release.
4. The tag workflow tests and builds Windows NSIS and Linux AppImage, `.deb`, and `.rpm` packages. It keeps the release as a draft until both jobs complete and checks that `latest.json` contains Windows and Linux update entries and the Windows signature before publishing.
5. Inspect the published assets and install the Windows `.exe` once. Later versions can be installed from **Settings → Check for updates** or the update indicator above Settings. The app offers Install, Ignore, and Cancel.

Older Electron releases do not contain the Tauri updater feed. Each Tauri release must include signed Windows and Linux updater entries in `latest.json`; a source commit alone never triggers an in-app update.

## Local build

On Windows, after installing [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):

```powershell
npm ci
npm ci --prefix tauri-v2
npm --prefix tauri-v2 run tauri -- build --bundles nsis
```

The updater signing key must be available to the build through `TAURI_SIGNING_PRIVATE_KEY`. Never commit it or include it in logs. The NSIS installer is written under `tauri-v2/src-tauri/target/release/bundle/nsis/`.

AppImage is a portable Linux bundle; `.deb` and `.rpm` install launchers that can be pinned in a desktop environment. The Linux packages still need an installed-desktop smoke test before broad distribution. macOS packaging and mobile store delivery remain future work. Workspace backups use relative paths and a platform-independent SQLite schema so data can move across these targets.
