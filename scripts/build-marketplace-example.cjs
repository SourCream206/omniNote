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
  console.log(`Marketplace example ready in ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
