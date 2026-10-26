# Local extensions (API 1.0)

Extensions are directories under the active workspace's `extensions/` folder. Each directory name must match the `id` in its `extension.json`. The app loads installed extensions disabled by default. Open **Extensions** from the left activity rail to review and enable one; the enable dialog lists its requested permissions.

The bundled `whiteboard.date-insert` is the small core example. It is copied on first launch and pre-enabled only when its source matches the bundled file. `examples/contributions/` is a broader demonstration; copy that directory to `extensions/omninote.contributions` to inspect its contribution points. It is not installed automatically.

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
