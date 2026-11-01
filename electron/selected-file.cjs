const fs = require('node:fs');
const path = require('node:path');

const maxAssetBytes = 100 * 1024 * 1024;
const executableExtensions = new Set(['.appref-ms', '.bat', '.cmd', '.com', '.cpl', '.desktop', '.exe', '.hta', '.jar', '.js', '.jse', '.lnk', '.msi', '.msp', '.pif', '.ps1', '.reg', '.scr', '.url', '.vbs', '.vbe', '.wsf', '.wsh']);

async function readSelectedFile(filePath, limit = maxAssetBytes) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (!size || size > limit) throw new Error('File must be between 1 byte and 100 MB');
    const chunks = [];
    let total = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      total += chunk.length;
      if (total > limit) throw new Error('File must be between 1 byte and 100 MB');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

function assertSafeToOpen(fileName) {
  if (executableExtensions.has(path.extname(fileName.replace(/[.\s]+$/, '')).toLowerCase())) throw new Error('Executable attachments cannot be launched from omniNote. Open the workspace folder to inspect the file.');
}

module.exports = { assertSafeToOpen, readSelectedFile };
