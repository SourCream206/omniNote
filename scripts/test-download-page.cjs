const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'download page script is present');

async function checkRelease(assets, expected) {
  const elements = new Map();
  const document = { getElementById(id) {
    if (!elements.has(id)) elements.set(id, { hidden: true, href: '#', textContent: '' });
    return elements.get(id);
  } };
  const release = { tag_name: 'v0.0.9', assets: assets.map((name) => ({ name, browser_download_url: `https://example.test/${name}` })) };
  vm.runInNewContext(script, { document, fetch: async () => ({ ok: true, json: async () => release }) });
  await new Promise((resolve) => setImmediate(resolve));
  for (const id of expected) {
    assert.equal(elements.get(id)?.hidden, false, `${id} should be visible`);
    assert.match(elements.get(id)?.href ?? '', /^https:\/\/example\.test\//);
  }
  for (const id of ['linux-deb', 'linux-rpm', 'linux-arch', 'linux-portable'].filter((id) => !expected.includes(id))) {
    assert.notEqual(elements.get(id)?.hidden, false, `${id} should stay hidden`);
  }
}

const prefix = 'omniNote-0.0.9-linux-';
checkRelease([
  'omniNote-Setup-0.0.9.exe',
  `${prefix}x86_64.AppImage`, `${prefix}amd64.deb`, `${prefix}x86_64.rpm`, `${prefix}x86_64.pacman`,
], ['linux-deb', 'linux-rpm', 'linux-arch', 'linux-portable'])
  .then(() => checkRelease(['omniNote-Setup-0.0.9.exe', `${prefix}x86_64.AppImage`], ['linux-portable']))
  .then(() => console.log('Download page release links passed'))
  .catch((error) => { console.error(error); process.exitCode = 1; });
