const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

async function main() {
  const output = path.resolve(__dirname, '..', 'marketplace', 'dist');
  fs.mkdirSync(output, { recursive: true });
  const extensions = [];
  for (const [directory, summary] of [
    ['date-insert', "Insert today's date onto the current page."],
    ['contributions', 'Example toolbar, document viewer, importer, and exporter.'],
  ]) {
    const source = path.resolve(__dirname, '..', 'examples', directory);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'extension.json'), 'utf8'));
    const zip = new JSZip();
    for (const name of fs.readdirSync(source)) zip.file(name, fs.readFileSync(path.join(source, name)));
    const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const filename = `${manifest.id}-${manifest.version}.zip`;
    fs.writeFileSync(path.join(output, filename), archive);
    extensions.push({ id: manifest.id, name: manifest.name, summary, version: manifest.version, apiVersion: manifest.apiVersion, permissions: manifest.permissions, package: filename, sha256: crypto.createHash('sha256').update(archive).digest('hex') });
  }
  const catalog = { schemaVersion: 1, extensions };
  fs.writeFileSync(path.join(output, 'catalog.json'), JSON.stringify(catalog, null, 2));
  fs.copyFileSync(path.resolve(__dirname, '..', 'marketplace', 'index.html'), path.join(output, 'index.html'));
  fs.mkdirSync(path.join(output, 'extensions'), { recursive: true });
  fs.copyFileSync(path.resolve(__dirname, '..', 'marketplace', 'extensions', 'index.html'), path.join(output, 'extensions', 'index.html'));
  console.log(`Marketplace example ready in ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
