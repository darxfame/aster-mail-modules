const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const permissionNames = ['ui', 'storage', 'network', 'calendar.read', 'meeting.draft', 'events', 'meeting.launch', 'auth.session'];
const featureNames = ['meeting.launch', 'auth.session', 'auth.start-origin', 'auth.identity-redirects', 'rpc.error-details', 'network.origin-grants', 'settings.migrations'];
function fail() { throw new Error('Invalid catalog or pinned package mismatch'); }
function keys(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail();
}
function list(value, limit, check) { if (!Array.isArray(value) || value.length > limit || new Set(value).size !== value.length || value.some(item => !check(item))) fail(); }
function origin(value) {
  try { const url = new URL(value); return typeof value === 'string' && url.protocol === 'https:' && !url.username && !url.password && !url.hostname.includes('*') && value === url.origin; } catch { return false; }
}
function directory(value) { return typeof value === 'string' && value.length <= 200 && /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'); }
function validateCatalog(catalog) {
  if (Buffer.byteLength(JSON.stringify(catalog)) > 262144) fail();
  keys(catalog, ['schemaVersion', 'modules']);
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.modules) || catalog.modules.length > 200) fail();
  const ids = new Set();
  for (const entry of catalog.modules) {
    keys(entry, ['id', 'name', 'version', 'source', 'sha256', 'permissions', 'networkOrigins', 'networkHeaders', 'optionalOrigins', 'meetingLinks', 'authentication', 'host'], ['id', 'name', 'version', 'source', 'sha256', 'permissions', 'networkOrigins', 'networkHeaders', 'host']);
    if (typeof entry.id !== 'string' || !/^[a-z][a-z0-9.-]{2,79}$/.test(entry.id) || ids.has(entry.id) || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 80 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(entry.name) || typeof entry.version !== 'string' || entry.version.length > 40 || !/^\d+\.\d+\.\d+$/.test(entry.version) || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail();
    ids.add(entry.id); keys(entry.source, ['repository', 'commit', 'directory']);
    if (typeof entry.source.repository !== 'string' || entry.source.repository.length > 300 || !/^https:\/\/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(entry.source.repository) || /\/(?:\.|\.\.)$|\.git$/.test(entry.source.repository) || !/^[a-f0-9]{40}$/.test(entry.source.commit) || !directory(entry.source.directory)) fail();
    list(entry.permissions, 8, item => permissionNames.includes(item));
    list(entry.networkOrigins, 8, origin); list(entry.networkHeaders, 8, item => typeof item === 'string' && /^x-[a-z][a-z0-9-]{0,63}$/.test(item));
    keys(entry.host, ['apiVersion', 'features']);
    if (entry.host.apiVersion !== 1) fail(); list(entry.host.features, 8, item => featureNames.includes(item));
    if ((entry.networkOrigins.length || entry.networkHeaders.length) && !entry.permissions.includes('network')) fail();
    if (entry.optionalOrigins !== undefined) {
      list(entry.optionalOrigins, 8, rule => rule && typeof rule.domain === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(rule.domain) && typeof rule.includeSubdomains === 'boolean' && Object.keys(rule).every(key => ['domain', 'includeSubdomains'].includes(key)));
      if (!entry.permissions.includes('network') || !entry.host.features.includes('network.origin-grants')) fail();
    }
    if (entry.meetingLinks !== undefined) {
      keys(entry.meetingLinks, ['scheme', 'origins']);
      if (entry.meetingLinks.scheme !== 'ktalk' || !entry.permissions.includes('meeting.launch') || !entry.host.features.includes('meeting.launch')) fail();
      list(entry.meetingLinks.origins, 8, origin); if (!entry.meetingLinks.origins.length) fail();
    } else if (entry.permissions.includes('meeting.launch')) fail();
    if (entry.authentication !== undefined) {
      keys(entry.authentication, ['type', 'origins', 'identityOrigins', 'capture', 'authorization', 'startOrigin', 'identityRedirects'], ['type', 'origins', 'identityOrigins', 'capture', 'authorization']);
      if (entry.authentication.type !== 'browser-token' || !entry.permissions.includes('auth.session') || !entry.host.features.includes('auth.session') || !entry.permissions.includes('network')) fail();
      list(entry.authentication.origins, 8, item => origin(item) && entry.networkOrigins.includes(item)); list(entry.authentication.identityOrigins, 8, origin);
      if (!entry.authentication.origins.length) fail();
      if (entry.authentication.startOrigin !== undefined && (!origin(entry.authentication.startOrigin) || ![...entry.authentication.origins, ...entry.authentication.identityOrigins].includes(entry.authentication.startOrigin) || !entry.host.features.includes('auth.start-origin'))) fail();
      if (entry.authentication.identityRedirects !== undefined && (typeof entry.authentication.identityRedirects !== 'boolean' || !entry.host.features.includes('auth.identity-redirects'))) fail();
      const capture = entry.authentication.capture;
      keys(capture, ['storage', 'key', 'tokenPath', 'expiresAtPath', 'rejectPath'], ['storage', 'key', 'tokenPath', 'expiresAtPath']);
      if (!['localStorage', 'sessionStorage'].includes(capture.storage) || typeof capture.key !== 'string' || !capture.key || capture.key.length > 80) fail();
      for (const key of ['tokenPath', 'expiresAtPath', ...(capture.rejectPath ? ['rejectPath'] : [])]) {
        list(capture[key], 8, value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value));
        if (!capture[key].length) fail();
      }
      keys(entry.authentication.authorization, ['scheme']);
      if (!/^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(entry.authentication.authorization.scheme)) fail();

    } else if (entry.permissions.includes('auth.session')) fail();
  }
  return catalog;
}
function fingerprint(files) {
  const digest = crypto.createHash('sha256');
  for (const name of [...files.keys()].sort()) digest.update(name).update('\0').update(crypto.createHash('sha256').update(files.get(name)).digest());
  return digest.digest('hex');
}
function pinnedFiles(entry) {
  const read = file => execFileSync('git', ['show', `${entry.source.commit}:${entry.source.directory}/${file}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const files = new Map([['module.json', read('module.json')]]);
  const manifest = JSON.parse(files.get('module.json'));
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 199) fail();
  for (const name of manifest.files) { if (!directory(name) || name === 'module.json' || files.has(name)) fail(); files.set(name, read(name)); }
  return files;
}
function verifyEntry(entry, files, host) {
  validateCatalog({ schemaVersion: 1, modules: [entry] });
  const manifest = JSON.parse(files.get('module.json'));
  if (host) { if (entry.host.features.some(feature => !(host.features || []).includes(feature))) fail(); host.fromFiles(files); }
  if (files.size !== manifest.files.length + 1 || manifest.files.some(file => !files.has(file)) || fingerprint(files) !== entry.sha256) fail();
  for (const key of ['id', 'name', 'version', 'optionalOrigins', 'meetingLinks', 'authentication']) assert.deepEqual(entry[key], manifest[key]);
  if (manifest.apiVersion !== entry.host.apiVersion) fail();
  if ((manifest.settingsVersion !== undefined || manifest.settingsMigrations !== undefined) && !entry.host.features.includes('settings.migrations')) fail();
  for (const key of ['permissions', 'networkOrigins', 'networkHeaders']) assert.deepEqual([...entry[key]].sort(), [...(manifest[key] || [])].sort());
  return true;
}
module.exports = { validateCatalog, fingerprint, verifyEntry, pinnedFiles };
if (require.main === module) {
  const catalog = validateCatalog(JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'))));
  const host = process.env.ASTER_MAIL_HOST ? require(path.join(path.resolve(process.env.ASTER_MAIL_HOST), 'desktop/modules.cjs')) : null;
  for (const entry of catalog.modules) {
    if (entry.source.repository !== 'https://github.com/darxfame/aster-mail-modules') throw new Error('Use the client downloader for external repositories');
    verifyEntry(entry, pinnedFiles(entry), host);
  }
  console.log(`Validated ${catalog.modules.length} immutable catalog entries${host ? ' with the authoritative host' : ''}.`);
}
