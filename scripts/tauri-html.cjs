const { renameSync } = require('node:fs');
const { join } = require('node:path');

renameSync(join(__dirname, '..', 'dist-tauri', 'tauri.html'), join(__dirname, '..', 'dist-tauri', 'index.html'));
