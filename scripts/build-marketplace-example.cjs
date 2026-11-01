const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

async function main() {
  const source = path.resolve(__dirname, '..', 'examples', 'contributions');
  const output = path.resolve(__dirname, '..', 'marketplace', 'dist');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'extension.json'), 'utf8'));
  const zip = new JSZip();
  for (const name of fs.readdirSync(source)) zip.file(name, fs.readFileSync(path.join(source, name)));
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const filename = `${manifest.id}-${manifest.version}.zip`;
  const catalog = { schemaVersion: 1, extensions: [{ id: manifest.id, name: manifest.name, summary: 'Example toolbar, document viewer, importer, and exporter.', version: manifest.version, apiVersion: manifest.apiVersion, permissions: manifest.permissions, package: filename, sha256: crypto.createHash('sha256').update(archive).digest('hex') }] };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, filename), archive);
  fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>omniNote extensions</title><style>body{font:15px system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.5rem;color:#243247}h1{font-size:1.5rem}p{line-height:1.6;color:#52657c}a{color:#285f91}</style><h1>omniNote extensions</h1><p>Browse and install extensions from the Extensions sidebar in omniNote.</p><p><a href="catalog.json">View catalog</a></p>');
  console.log(`Marketplace example ready in ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
