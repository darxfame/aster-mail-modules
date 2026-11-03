// Anonymous GitHub download only; no installation, activation or account required.
const electron = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const hostRoot = process.env.ASTER_MAIL_HOST;
if (!hostRoot) throw new Error('Set ASTER_MAIL_HOST to the compatible host checkout');
const G = require(path.join(hostRoot, 'desktop/module-github.cjs'));
const M = require(path.join(hostRoot, 'desktop/modules.cjs'));
const C = require('./catalog.cjs');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-catalog-check-'));
electron.app.setPath('userData', profile);
electron.app.whenReady().then(async () => {
  const isolated = electron.session.fromPartition(`aster-catalog-check-${Date.now()}`, { cache: false });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
  try {
    const bytes = await G.getBytes(electron.net, isolated, 'https://raw.githubusercontent.com/darxfame/aster-mail-modules/main/catalog.json', 262144, controller.signal);
    const catalog = C.validateCatalog(JSON.parse(bytes.toString('utf8')));
    assert.ok(catalog.modules.length);
    for (const entry of catalog.modules) {
      const bundle = await G.load({ url: entry.source.repository, ref: entry.source.commit, directory: entry.source.directory }, (url, limit, signal) => G.getBytes(electron.net, isolated, url, limit, signal), controller.signal);
      assert.equal(bundle.source.commit, entry.source.commit);
      C.verifyEntry(entry, bundle.files, M);
      console.log(`PASS: GitHub catalog ${entry.id} ${entry.version}, commit ${entry.source.commit}, SHA-256 ${entry.sha256}, exact permissions and origins`);
    }
  } finally { clearTimeout(timer); await Promise.allSettled([isolated.closeAllConnections(), isolated.clearStorageData()]); }
  electron.app.exit(0);
}).catch(error => { console.error(error.message); electron.app.exit(1); });
