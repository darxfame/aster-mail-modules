// Real Electron integration, fictional account and intercepted service responses only.
const electron = require('electron');
const { app, BrowserWindow } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const hostRoot = process.env.ASTER_MAIL_HOST;
if (!hostRoot) throw new Error('Set ASTER_MAIL_HOST to the Aster Mail codex/modules checkout');
const M = require(path.join(hostRoot, 'desktop/modules.cjs'));
const { ModuleHost } = require(path.join(hostRoot, 'desktop/module-host.cjs'));
const profile = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'aster-ktalk-native-'));
app.setName('KTalk module test'); app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let host, owner;
app.whenReady().then(async () => {
  let records = [], sessionId = 'fictional-session', puts = 0, patch = null, theme = 'light';
  const active = new AbortController();
  const { LocalStore } = require(path.join(hostRoot, 'desktop/local-store.cjs'));
  const store = new LocalStore(path.join(profile, 'fictional-account'), electron.safeStorage);
  await store.load('fictional-account'); store.requireEncryption();
  // Intercept only the fictional auth window. No login request reaches the Internet.
  const fromPartition = electron.session.fromPartition.bind(electron.session);
  let originPrompts = 0;
  const fixtureElectron = { ...electron, dialog: { async showMessageBox(options) { assert.match(options.detail, /https:\/\/diy.ktalk.ru/); originPrompts++; return { response: 1 }; } }, session: { fromPartition(partition, options) {
    const isolated = fromPartition(partition, options);
    if (partition.startsWith('aster-module-auth-')) {
      isolated.protocol.handle('https', request => {
        if (new URL(request.url).origin !== 'https://app.ktalk.ru') return new Response('Fictional identity provider', { headers: { 'Content-Type': 'text/html' } });
        return new Response('<!doctype html><title>Fictional corporate sign-in</title><button id="login">Sign in with fictional credentials</button><script>document.querySelector("button").onclick=()=>localStorage.setItem("session",JSON.stringify({data:{token:"fictional-private-session",expiresAt:"2099-01-01T00:00:00Z",anonymous:false}}))</script>', { headers: { 'Content-Type': 'text/html' } });
      });
    }
    return isolated;
  } } };
  host = new ModuleHost({ electron: fixtureElectron, directory: path.join(profile, 'modules'), scope: () => ({ sessionId, signal: active.signal, records }), save: async (value, id) => {
    const guard = () => { if (id !== sessionId) throw new Error('Fictional account retired'); };
    await store.save({ modules: value }, guard); records = value;
  },
    sdk: async (_entry, method, input) => {
      if (method === 'ui.context') return { language: 'ru', theme, timeZone: 'Europe/Minsk', interfaceScale: 100 };
      if (method === 'meeting.getDraft') return { title: 'Fictional meeting', body: 'Agenda must survive', start: '2026-11-04T12:00:00Z', end: '2026-11-04T13:00:00Z' };
      if (method === 'meeting.patchDraft') { patch = input; return true; }
      throw new Error('No other host actions allowed in this fixture');
    } });
  const bundle = await M.readPackage(path.join(__dirname, '../ktalk'));
  await host.install(bundle); await host.configure(bundle.manifest.id, true);
  const invoke = (command, input) => host.invoke(bundle.manifest.id, command, input);
  await invoke('save', { server: 'diy.ktalk.ru', apiKey: '' });
  assert.deepEqual(records[0].originGrants, ['https://diy.ktalk.ru']); assert.equal(originPrompts, 1);
  assert.ok(host.definition(host.entries.get(bundle.manifest.id)).authentication.origins.includes('https://diy.ktalk.ru'));
  await invoke('save', { server: 'app.ktalk.ru', apiKey: '' });
  let result = await invoke('login'); assert.equal(result.auth.pending, true);
  let entry = host.entries.get(bundle.manifest.id); const loginWindow = entry.authFlow.window;
  assert.equal(loginWindow.webContents.getLastWebPreferences().sandbox, true);
  assert.equal(loginWindow.webContents.getLastWebPreferences().nodeIntegration, false);
  assert.notEqual(loginWindow.webContents.session, electron.session.defaultSession);
  assert.equal(await loginWindow.webContents.executeJavaScriptInIsolatedWorld(998, [{ code: 'typeof require' }]), 'undefined');
  await loginWindow.webContents.executeJavaScript('document.querySelector("#login").click()');
  const until = Date.now() + 7000;
  while (!records[0].auth && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(records[0].auth?.token, 'fictional-private-session');
  const encrypted = await fs.readFile(path.join(profile, 'fictional-account/local-data.enc'));
  assert.equal(encrypted.includes(Buffer.from('fictional-private-session')), false);
  const restored = new LocalStore(path.join(profile, 'fictional-account'), electron.safeStorage);
  assert.equal((await restored.load('fictional-account')).modules[0].auth.token, 'fictional-private-session');
  assert.equal(loginWindow.isDestroyed(), true);
  result = await invoke('settings'); assert.equal(result.auth.connected, true);
  assert.doesNotMatch(JSON.stringify(result), /fictional-private-session/);
  assert.doesNotMatch(JSON.stringify(await host.catalog()), /fictional-private-session/);
  const originalRequest = M.requestJSON;
  M.requestJSON = async (_net, _session, _definition, input, _signal, token) => {
    assert.equal(token, 'fictional-private-session'); assert.equal(input.auth, 'session');
    if (input.method === 'GET') throw Object.assign(new Error('Fictional missing room'), { code: 'http-error', status: 404 });
    puts++; assert.equal(records[0].data.pending.status, 'unknown');
    return { roomName: input.url.split('/').at(-1), title: input.body.title };
  };
  result = await invoke('create', { title: 'Встреча команды', confirm: true });
  assert.equal(result.pending?.status, 'created', JSON.stringify(result)); assert.equal(puts, 1);
  assert.equal((await invoke('create', { title: 'Must not repeat', confirm: true })).error, 'pending');
  await host.invoke(bundle.manifest.id, 'insert', {}, { editorId: 'fictional-editor', draft: { body: 'Agenda must survive' } });
  assert.match(patch.body, /^Agenda must survive\n\n/); assert.match(patch.location, /^https:\/\/app.ktalk.ru\/aster/);
  await host.update(records => { records[0].data.fixtureMigrationSource = 'kept'; });
  const beforeUpdate = structuredClone(records[0]);
  const nextFiles = new Map(bundle.files), nextManifest = JSON.parse(nextFiles.get('module.json'));
  nextManifest.version = '0.1.3'; nextManifest.settingsVersion = 2;
  nextManifest.settingsMigrations = [{ from: 1, to: 2, operations: [{ op: 'rename', from: ['fixtureMigrationSource'], path: ['fixtureMigrationTarget'] }] }];
  nextFiles.set('module.json', Buffer.from(JSON.stringify(nextManifest)));
  await host.install(M.fromFiles(nextFiles));
  assert.equal(records[0].data.fixtureMigrationTarget, 'kept');
  const persistedUpgrade = await new LocalStore(path.join(profile, 'fictional-account'), electron.safeStorage).load('fictional-account');
  assert.equal(persistedUpgrade.modules[0].data.fixtureMigrationTarget, 'kept');
  assert.equal(persistedUpgrade.modules[0].settingsVersion, 2);
  assert.deepEqual(records[0].data.pending, beforeUpdate.data.pending);
  assert.equal(records[0].auth.token, beforeUpdate.auth.token);
  assert.deepEqual(records[0].originGrants, beforeUpdate.originGrants);
  assert.equal((await invoke('create', { title: 'Must not repeat after update', confirm: true })).error, 'pending'); assert.equal(puts, 1);
  entry = host.entries.get(bundle.manifest.id);
  M.requestJSON = originalRequest;
  owner = new BrowserWindow({ width: 800, height: 760, show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } });
  await owner.loadURL('data:text/html,<title>KTalk fictional UI fixture</title>');
  const screenshots = path.join(__dirname, '../docs/screenshots'); await fs.mkdir(screenshots, { recursive: true });
  for (const scale of [1, 1.5, 2]) {
    owner.webContents.setZoomFactor(scale);
    const bounds = { x: 0, y: 0, width: 780 / scale, height: 700 / scale };
    await host.mounts(owner, [{ id: bundle.manifest.id, view: 'panel', bounds }]);
    const view = [...host.views.values()][0].view;
    await new Promise(resolve => setTimeout(resolve, 250));
    const ui = await view.webContents.executeJavaScript('({ ready: document.querySelector("#server").value, overflow: document.documentElement.scrollWidth > window.innerWidth, password: document.querySelector("#api-key").value })');
    assert.equal(ui.ready, 'https://app.ktalk.ru'); assert.equal(ui.overflow, false); assert.equal(ui.password, '');
    const png = await view.webContents.capturePage(); await fs.writeFile(path.join(screenshots, `ktalk-light-${Math.round(scale * 100)}.png`), png.toPNG());
  }
  const view = [...host.views.values()][0].view;
  await view.webContents.executeJavaScript('document.body.dataset.theme="dark"');
  await fs.writeFile(path.join(screenshots, 'ktalk-dark-200.png'), (await view.webContents.capturePage()).toPNG());
  await view.webContents.executeJavaScript('document.querySelector("#existing-url").focus(); document.querySelector("#existing-url").scrollIntoView({block:"center"})');
  assert.equal(await view.webContents.executeJavaScript('document.activeElement.id'), 'existing-url');
  await fs.writeFile(path.join(screenshots, 'ktalk-dark-200-bottom.png'), (await view.webContents.capturePage()).toPNG());
  assert.equal((await invoke('settings')).pending.status, 'created');
  await invoke('logout'); assert.equal(records[0].auth, undefined);
  await invoke('login'); assert.ok(entry.authFlow);
  sessionId = 'other-account'; host.closeAll(); assert.equal(entry.authFlow, null);
  const handler = app.getApplicationNameForProtocol('ktalk://aster-module-test.invalid/test_room');
  console.log(`KTalk protocol handler: ${handler || 'not installed'}`);
  console.log('PASS: actual sandbox runtime, corporate login window, isolated session capture, encrypted-store handoff, no token in catalog, single create, preserved draft, update and persisted settings migration, 100/150/200% layouts, logout and account retirement');
  owner.destroy(); host.closeAll(); await store.clear(); app.exit(0);
}).catch(error => { console.error(error); host?.closeAll(); if (owner && !owner.isDestroyed()) owner.destroy(); app.exit(1); });
