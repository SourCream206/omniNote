const assert = require('node:assert/strict');
const { assertReleaseConfig, githubRepository, hasUpdateSource } = require('../electron/distribution.cjs');

assert.throws(() => assertReleaseConfig({ marketplaceUrl: '', updateUrl: '' }), /updateUrl/);
assert.throws(() => assertReleaseConfig({ marketplaceUrl: 'http://example.com/catalog.json', updateUrl: 'https://updates.example.com/' }), /marketplaceUrl/);
assert.throws(() => assertReleaseConfig({ marketplaceUrl: 'https://extensions.example.com/catalog.json', updateUrl: 'https://example.invalid/updates/' }), /updateUrl/);
assert.deepEqual(assertReleaseConfig({ marketplaceUrl: 'https://extensions.example.com/catalog.json', updateUrl: 'https://updates.example.com/' }), { marketplaceUrl: 'https://extensions.example.com/catalog.json', updateUrl: 'https://updates.example.com/' });
assert.equal(assertReleaseConfig({ marketplaceUrl: '', githubRepository: 'SourCream206/omniNote' }).githubRepository, 'SourCream206/omniNote');
assert.deepEqual(githubRepository('SourCream206/omniNote'), { owner: 'SourCream206', repo: 'omniNote' });
assert.equal(githubRepository('https://github.com/SourCream206/omniNote'), null);
assert.equal(hasUpdateSource({ githubRepository: 'SourCream206/omniNote' }), true);
assert.equal(hasUpdateSource({ githubRepository: 'SourCream206/omniNote', githubPrivate: true }), true);
assert.deepEqual(assertReleaseConfig({ marketplaceUrl: 'https://extensions.example.com/catalog.json', githubRepository: 'SourCream206/omniNote' }).githubRepository, 'SourCream206/omniNote');
console.log('Distribution address checks passed');
