const { config, githubRepository } = require('./electron/distribution.cjs');
const releaseRepo = githubRepository(config.githubRepository);

module.exports = {
  appId: 'app.omninote.desktop',
  productName: 'omniNote',
  asar: true,
  directories: { output: 'release' },
  files: [
    'dist-ui/**/*', 'electron/**/*', 'examples/date-insert/**/*', 'distribution.json', 'package.json',
    '!node_modules/@napi-rs/**', '!node_modules/@tiptap/**', '!node_modules/docx-preview/**',
    '!node_modules/dompurify/**', '!node_modules/exceljs/**', '!node_modules/lucide-react/**',
    '!node_modules/marked/**', '!node_modules/pdfjs-dist/**', '!node_modules/perfect-freehand/**',
    '!node_modules/react/**', '!node_modules/react-dom/**', '!node_modules/react-pdf/**',
  ],
  win: { target: 'nsis' },
  linux: {
    target: ['AppImage', 'deb', 'rpm', 'pacman'],
    category: 'Office',
    icon: 'build/linux-icon.svg',
    syncDesktopName: true,
    artifactName: '${productName}-${version}-linux-${arch}.${ext}',
  },
  nsis: { oneClick: false, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, artifactName: '${productName}-Setup-${version}.${ext}' },
  publish: releaseRepo ? [{ provider: 'github', ...releaseRepo, private: config.githubPrivate === true }] : config.updateUrl ? [{ provider: 'generic', url: config.updateUrl }] : undefined,
};
