const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

async function main() {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'marketplace', 'dist');
  fs.mkdirSync(output, { recursive: true });
  for (const name of fs.readdirSync(output)) if (name.endsWith('.zip')) fs.unlinkSync(path.join(output, name));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'marketplace', 'registry.json'), 'utf8'));
  if (!Array.isArray(registry)) throw new Error('Invalid marketplace registry');
  const extensions = [];
  for (const { source: directory, summary } of registry) {
    if (typeof directory !== 'string' || !/^(examples\/date-insert|marketplace\/extensions-src\/[a-z0-9]+(?:[.-][a-z0-9]+)*)$/.test(directory) || typeof summary !== 'string' || summary.length > 300) throw new Error('Invalid marketplace registry entry');
    const source = path.join(root, directory);
    if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Invalid extension directory: ${directory}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'extension.json'), 'utf8'));
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(manifest.id) || !/^\d+\.\d+\.\d+$/.test(manifest.version) || extensions.some((entry) => entry.id === manifest.id)) throw new Error(`Invalid extension identity in ${directory}`);
    const zip = new JSZip();
    for (const name of fs.readdirSync(source)) {
      const file = path.join(source, name);
      if (!/^[a-zA-Z0-9._-]+$/.test(name) || !fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error(`Invalid extension file: ${file}`);
      zip.file(name, fs.readFileSync(file));
    }
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
  console.log(`Marketplace ready in ${output}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
