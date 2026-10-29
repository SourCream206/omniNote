const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const maxCatalogBytes = 512 * 1024;
const maxPackageBytes = 10 * 1024 * 1024;
const maxUnpackedBytes = 20 * 1024 * 1024;
const validId = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const validVersion = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const validFile = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:json|js|html)$/;

async function readLimited(url, limit, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok || !response.body) throw new Error(`Marketplace request failed (${response.status})`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Marketplace response is too large');
      chunks.push(Buffer.from(value));
    }
  } finally { reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

function validateEntry(entry, catalogUrl) {
  if (!entry || typeof entry !== 'object' || !validId.test(entry.id) || !validVersion.test(entry.version) || !/^1\./.test(entry.apiVersion) || typeof entry.name !== 'string' || entry.name.length > 100 || typeof entry.summary !== 'string' || entry.summary.length > 300 || !Array.isArray(entry.permissions) || entry.permissions.some((value) => typeof value !== 'string' || value.length > 80) || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256) || typeof entry.package !== 'string') throw new Error('Invalid marketplace entry');
  const packageUrl = new URL(entry.package, catalogUrl);
  if (packageUrl.origin !== catalogUrl.origin || !packageUrl.pathname.endsWith('.zip') || packageUrl.username || packageUrl.password) throw new Error('Marketplace package must be on the catalog origin');
  return { ...entry, packageUrl: packageUrl.toString() };
}

function readZipFile(file, remaining) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const stream = file.nodeStream();
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size > remaining) { stream.destroy(); reject(new Error('Extension package is too large')); }
      else chunks.push(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

class Marketplace {
  constructor(store, catalogAddress, { allowHttpLoopback = false, fetchImpl = fetch } = {}) {
    this.store = store;
    this.fetchImpl = fetchImpl;
    this.catalogUrl = catalogAddress ? new URL(catalogAddress) : null;
    if (this.catalogUrl && (this.catalogUrl.protocol !== 'https:' && !(allowHttpLoopback && this.catalogUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(this.catalogUrl.hostname)))) throw new Error('Marketplace URL must use HTTPS');
  }

  async catalog() {
    if (!this.catalogUrl) return [];
    const data = JSON.parse((await readLimited(this.catalogUrl, maxCatalogBytes, this.fetchImpl)).toString('utf8'));
    if (data?.schemaVersion !== 1 || !Array.isArray(data.extensions) || data.extensions.length > 500) throw new Error('Invalid marketplace catalog');
    return data.extensions.map((entry) => validateEntry(entry, this.catalogUrl));
  }

  async search(query = '') {
    if (typeof query !== 'string' || query.length > 100) throw new Error('Invalid marketplace search');
    const entries = await this.catalog();
    const needle = query.trim().toLowerCase();
    return { configured: Boolean(this.catalogUrl), entries: entries.filter((entry) => `${entry.id} ${entry.name} ${entry.summary}`.toLowerCase().includes(needle)).map(({ id, name, summary, version, apiVersion, permissions }) => ({ id, name, summary, version, apiVersion, permissions })) };
  }

  async install(extensionId, version) {
    if (!validId.test(extensionId) || !validVersion.test(version)) throw new Error('Invalid extension selection');
    const entry = (await this.catalog()).find((item) => item.id === extensionId && item.version === version);
    if (!entry) throw new Error('Extension version is not in the marketplace');
    const extensionDir = path.resolve(this.store.extensionDir);
    const destination = path.resolve(extensionDir, extensionId);
    if (path.dirname(destination) !== extensionDir) throw new Error('Invalid extension path');
    if (fs.existsSync(destination)) throw new Error('Extension is already installed');
    const archive = await readLimited(entry.packageUrl, maxPackageBytes, this.fetchImpl);
    if (crypto.createHash('sha256').update(archive).digest('hex') !== entry.sha256.toLowerCase()) throw new Error('Extension package checksum mismatch');
    const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
    const files = Object.values(zip.files).filter((file) => !file.dir);
    if (!files.length || files.length > 30 || files.some((file) => !validFile.test(file.name) || (Number(file.unixPermissions) & 0o170000) === 0o120000)) throw new Error('Invalid extension package contents');
    const contents = new Map();
    let unpacked = 0;
    for (const file of files) {
      const bytes = await readZipFile(file, maxUnpackedBytes - unpacked);
      unpacked += bytes.length;
      contents.set(file.name, bytes);
    }
    const manifest = JSON.parse(contents.get('extension.json')?.toString('utf8') ?? 'null');
    if (manifest?.id !== entry.id || manifest?.version !== entry.version || manifest?.apiVersion !== entry.apiVersion || !Array.isArray(manifest.permissions) || JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify([...entry.permissions].sort()) || typeof manifest.main !== 'string' || !/^[\w.-]+\.js$/.test(manifest.main) || !contents.has(manifest.main) || !manifest.contributes || typeof manifest.contributes !== 'object') throw new Error('Extension manifest differs from marketplace listing');
    const staging = path.resolve(extensionDir, `.install-${crypto.randomUUID()}`);
    if (path.dirname(staging) !== extensionDir) throw new Error('Invalid staging path');
    fs.mkdirSync(staging);
    try {
      for (const [name, bytes] of contents) fs.writeFileSync(path.join(staging, name), bytes, { flag: 'wx' });
      fs.renameSync(staging, destination);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return { id: entry.id, version: entry.version };
  }
}

module.exports = { Marketplace };
