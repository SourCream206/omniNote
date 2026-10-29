const config = require('../distribution.json');

function validHttpsAddress(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hostname.endsWith('.invalid');
  } catch { return false; }
}

function githubRepository(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) return null;
  const [owner, repo] = value.split('/');
  return { owner, repo };
}

function hasUpdateSource(value = config) {
  return Boolean(githubRepository(value.githubRepository) || validHttpsAddress(value.updateUrl));
}

function assertReleaseConfig(value = config) {
  if (value.marketplaceUrl && !validHttpsAddress(value.marketplaceUrl)) throw new Error('Set a real HTTPS marketplaceUrl in distribution.json before building an installer');
  if (!hasUpdateSource(value)) throw new Error('Set githubRepository or HTTPS updateUrl in distribution.json before building an installer');
  return value;
}

module.exports = { config, assertReleaseConfig, githubRepository, hasUpdateSource };
