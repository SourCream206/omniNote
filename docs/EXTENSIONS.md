# Local extensions (API 1.0)

## Marketplace

The Extensions sidebar can search a configured online catalog and install a package into the local `extensions/` directory. The package must be on the catalog's HTTPS origin, match its SHA-256 digest, and have a manifest with the listed ID, version, API version, and permissions. New installs stay disabled until the user reviews and grants their permissions. Installed extensions continue to work offline. Extension update and uninstall flows are not implemented yet.

`distribution.json` points to the public GitHub Pages catalog at `https://sourcream206.github.io/omniNote/catalog.json`. The `.github/workflows/marketplace-pages.yml` workflow rebuilds and publishes the catalog when its registry or extension source changes; the app fetches it when Extensions opens or the search changes. Package paths are relative to the catalog. For local development, generate the catalog with `npm run marketplace:example`, then serve `marketplace/dist/` locally. The catalog and packages are public; installed extensions continue to work offline.

To propose an extension, use **Submit** in the app or [the submission form](https://github.com/SourCream206/omniNote/issues/new?template=extension-submission.yml). Include a public source repository, version, what it does, and its permissions. After review, a maintainer copies the flat extension files into `marketplace/extensions-src/<publisher.extension>/` and adds `{ "source": "marketplace/extensions-src/<publisher.extension>", "summary": "..." }` to `marketplace/registry.json`. A pull request can include those files and registry entry directly. `npm run marketplace:example` packages registered extensions and calculates their SHA-256 hashes; merging to `main` publishes the new catalog through GitHub Pages. The maintainer reviews all submissions before merging.

Catalog format:

```json
{
  "schemaVersion": 1,
  "extensions": [{
    "id": "publisher.extension",
    "name": "Example",
    "summary": "What it adds",
    "version": "1.0.0",
    "apiVersion": "1.0.0",
    "permissions": ["canvas.write"],
    "package": "publisher.extension-1.0.0.zip",
    "sha256": "64 lowercase hexadecimal characters"
  }]
}
```

The ZIP contains flat files: `extension.json`, the declared `.js` entry, and any declared `.html` views. The main process fetches and checks the catalog and package; extension workers and frames still have no direct network access. The digest protects against a package that differs from the trusted catalog, so control of the catalog host remains a security boundary.

Extensions are directories under the active workspace's `extensions/` folder. Each directory name must match the `id` in its `extension.json`. The app loads installed extensions disabled by default. Open **Extensions** from the left activity rail to review and enable one; the enable dialog lists its requested permissions.

The bundled `whiteboard.date-insert` is the small core example. It is copied on first launch and pre-enabled only when its source matches the bundled file. `examples/contributions/` remains a development fixture for extension API tests and is not in the marketplace.

## Manifest

```json
{
  "id": "example.notes",
  "name": "Example notes",
  "version": "1.0.0",
  "apiVersion": "1.0.0",
  "main": "extension.js",
  "activationEvents": ["onCommand:example.notes.insert"],
  "permissions": ["canvas.write"],
  "contributes": {
    "commands": [{ "id": "example.notes.insert", "title": "Insert note" }],
    "toolbar": [{ "command": "example.notes.insert", "label": "Insert note" }]
  }
}
```

`main` is one JavaScript file in the extension directory. Commands run in a fresh Web Worker with a five-second timeout. The worker receives `{ type: "invoke", command, requestId, apiVersion, settings, context }` and can send **one** response with the same `requestId`:

```js
self.onmessage = ({ data }) => {
  if (data.command === 'example.notes.insert') {
    self.postMessage({ type: 'canvas.insertText', requestId: data.requestId, text: 'Hello' });
  }
};
```

The current response types are `canvas.insertText`, `canvas.insertObject`, and `export.writeFile`. They require `canvas.write`, `canvas.write`, and `export.write` respectively. An importer receives `context.asset` and `context.bytes` only when `asset.read` was granted. An exporter can return a file name and bytes; the app asks where to save it. Toolbar and sidebar items invoke declared commands. The single **Export** menu includes declared exporters.

`canvasObjectTypes` and `documentViewers` declare local HTML entry files. The app loads those files in opaque-origin iframes with scripts allowed and a restrictive Content Security Policy. Each frame receives an `omninote:init` message containing `apiVersion`, `kind`, `data`, `bytes` when applicable, and `settings`. Frames can request `omninote:openExternal` for an `http:`, `https:`, or `mailto:` URL only when `link.open` was granted. The app keeps the original imported document unchanged even when an extension supplies a viewer.

Settings support `boolean` and `string` values. Settings are stored with the workspace and sent to workers and frames. API version `1.x` is accepted; there is no compatibility guarantee across major versions. `activationEvents` document when an extension is intended to run, while actual activation follows command invocation or an importer match in this version.

## Security and limits

Extensions run locally and should be treated as code from their author. The renderer cannot use Node directly, the worker is terminated after one response or timeout, and visual contributions use sandboxed frames. Permission checks happen in the host bridge. Network requests from the app are blocked; the only supported external action is opening an allowed link in the system browser. Extensions cannot currently add menus, access arbitrary files, or run background tasks.
