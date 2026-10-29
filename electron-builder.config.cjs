const { config, githubRepository } = require('./electron/distribution.cjs');
const releaseRepo = githubRepository(config.githubRepository);

module.exports = {
  appId: 'app.omninote.desktop',
  productName: 'omniNote',
  asar: true,
  directories: { output: 'release' },
  files: ['dist-ui/**/*', 'electron/**/*', 'examples/date-insert/**/*', 'distribution.json', 'package.json'],
  win: { target: 'nsis' },
  nsis: { oneClick: false, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, artifactName: '${productName}-Setup-${version}.${ext}' },
  publish: releaseRepo ? [{ provider: 'github', ...releaseRepo, private: config.githubPrivate === true }] : config.updateUrl ? [{ provider: 'generic', url: config.updateUrl }] : undefined,
};
