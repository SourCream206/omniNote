const path = require('node:path');

const labFiles = new Set(['ink-lab.html', 'src/spike.css', 'dist/spike.js']);

function resolveAppFile(projectRoot, requestUrl) {
  let url;
  let relative;
  try {
    url = new URL(requestUrl);
    relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  } catch { return null; }
  if (url.protocol !== 'whiteboard:' || url.hostname !== 'app' || relative.includes('\\') || relative.includes('%') || relative.split('/').includes('..')) return null;
  if (!relative.startsWith('dist-ui/') && !labFiles.has(relative)) return null;
  const absolute = path.resolve(projectRoot, relative);
  const allowedRoot = path.resolve(projectRoot, relative.startsWith('dist-ui/') ? 'dist-ui' : relative.split('/')[0]);
  return absolute.startsWith(allowedRoot + path.sep) || absolute === allowedRoot ? absolute : null;
}

module.exports = { resolveAppFile };
