const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function workspaceDirectory(documentsPath, userDataPath, override) {
  if (override) return override;
  const destination = path.join(documentsPath, 'omniNote', 'workspace');
  const legacy = path.join(userDataPath, 'workspace');
  if (fs.existsSync(path.join(destination, 'notes.sqlite')) || !fs.existsSync(path.join(legacy, 'notes.sqlite'))) return destination;
  if (fs.existsSync(destination)) throw new Error(`Cannot migrate workspace: ${destination} already exists without notes.sqlite`);
  const staging = `${destination}-migrating-${crypto.randomUUID()}`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(legacy, staging, { recursive: true, errorOnExist: true, force: false });
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(staging, destination); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code) || attempt >= 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * 2 ** attempt);
    }
  }
  return destination;
}

module.exports = { workspaceDirectory };
