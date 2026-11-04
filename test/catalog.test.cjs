const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../scripts/catalog.cjs');
const manifest = require('../ktalk/module.json');
const files = () => new Map(['module.json', ...manifest.files].map(file => [file, fs.readFileSync(path.join(__dirname, '../ktalk', file))]));
function entry() {
  return { id: manifest.id, name: manifest.name, version: manifest.version, source: { repository: 'https://github.com/darxfame/aster-mail-modules', directory: 'ktalk', commit: 'a'.repeat(40) }, sha256: C.fingerprint(files()), permissions: manifest.permissions, networkOrigins: manifest.networkOrigins, networkHeaders: manifest.networkHeaders, optionalOrigins: manifest.optionalOrigins, meetingLinks: manifest.meetingLinks, authentication: manifest.authentication, host: { apiVersion: 1, features: ['meeting.launch', 'auth.session', 'rpc.error-details', 'network.origin-grants', 'settings.migrations'] } };
}
test('catalog requires immutable commits, SHA-256, unique entries, declared scopes and no unknown fields', () => {
  assert.equal(C.validateCatalog({ schemaVersion: 1, modules: [entry()] }).modules.length, 1);
  for (const change of [{ source: { ...entry().source, commit: 'main' } }, { source: { ...entry().source, directory: '../ktalk' } }, { sha256: 'not-a-digest' }, { permissions: ['sendMail'] }, { authToken: 'never-publish' }, { networkOrigins: ['https://*.ktalk.ru'] }]) assert.throws(() => C.validateCatalog({ schemaVersion: 1, modules: [{ ...entry(), ...change }] }));
  assert.throws(() => C.validateCatalog({ schemaVersion: 1, modules: [entry(), entry()] }));
});
test('catalog verification rejects modified resources, permissions, identity origins and manifest versions', () => {
  assert.equal(C.verifyEntry(entry(), files()), true);
  assert.throws(() => C.verifyEntry(entry(), files(), { features: [], fromFiles() {} }));
  const modified = files(); modified.set('core.js', Buffer.from('changed'));
  assert.throws(() => C.verifyEntry(entry(), modified));
  assert.throws(() => C.verifyEntry({ ...entry(), permissions: entry().permissions.filter(item => item !== 'storage') }, files()));
  assert.throws(() => C.verifyEntry({ ...entry(), version: '99.0.0' }, files()));
  assert.throws(() => C.verifyEntry({ ...entry(), authentication: { ...entry().authentication, identityOrigins: ['https://evil.test'] } }, files()));
});

test('published package uses the common browser-token contract without a provider-specific host adapter', () => {
  assert.equal(manifest.authentication.type, 'browser-token');
  assert.deepEqual(manifest.authentication.capture.tokenPath, ['data', 'token']);
  assert.equal(manifest.authentication.authorization.scheme, 'Session');
});
