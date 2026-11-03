const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const main = import('../ktalk/main.js');
async function fixture(network, initial = {}) {
  let stored = structuredClone(initial), auth = { connected: false, origin: null }, writes = [], requests = [];
  const api = { async call(method, input) {
    if (method === 'storage.get') return structuredClone(stored);
    if (method === 'storage.set') { stored = structuredClone(input); return true; }
    if (method === 'auth.status') return auth;
    if (method === 'auth.signIn') { auth = { connected: true, origin: input.origin }; return auth; }
    if (method === 'auth.signOut') { auth = { connected: false, origin: null }; return true; }
    if (method === 'network.request') { requests.push(input); return network(input, stored); }
    if (method === 'ui.context') return { language: 'en' };
    if (method === 'meeting.getDraft') return api.draft;
    if (method === 'meeting.patchDraft' || method === 'meeting.openDraft') { writes.push({ method, input }); return true; }
    throw new Error(`Unexpected API: ${method}`);
  } };
  const { commands } = await (await main).activate(api);
  return { commands, api, requests, writes, state: () => structuredClone(stored), setAuth(value) { auth = value; } };
}
const notFound = () => { throw Object.assign(new Error('fictional missing room'), { code: 'http-error', status: 404 }); };
const configured = { server: 'https://yandex.ktalk.ru', apiKey: 'fictional-secret' };
test('server and room parsing accepts custom HTTPS and test_room but rejects escapes', async () => {
  const { serverOrigin, roomURL } = await import('../ktalk/core.js');
  assert.equal(serverOrigin('yandex.ktalk.ru'), 'https://yandex.ktalk.ru');
  assert.equal(serverOrigin('https://meet.example.test:8443'), 'https://meet.example.test:8443');
  for (const input of ['http://yandex.ktalk.ru', 'https://x@yandex.ktalk.ru', 'https://yandex.ktalk.ru/path', 'https://yandex.ktalk.ru?x=1', 'https://yandex.ktalk.ru\\@evil.test', 'localhost']) assert.throws(() => serverOrigin(input));
  const origins = ['https://yandex.ktalk.ru'];
  assert.equal(roomURL('https://yandex.ktalk.ru/test_room?pin=1234', origins), 'https://yandex.ktalk.ru/test_room?pin=1234');
  for (const input of ['ktalk://yandex.ktalk.ru/test_room', 'https://evil.test/test_room', 'https://yandex.ktalk.ru/api', 'https://yandex.ktalk.ru/a/b', 'https://yandex.ktalk.ru/%2e%2e/a']) assert.throws(() => roomURL(input, origins));
});
test('creation uses official upsert contract, persisted intent, scoped key and separate draft action', async () => {
  const f = await fixture((input, state) => {
    if (input.method === 'GET') return notFound();
    assert.equal(state.pending.status, 'unknown');
    assert.match(input.url, /^https:\/\/yandex.ktalk.ru\/api\/Rooms\/aster[a-f0-9]{32}$/);
    assert.deepEqual(input.headers, { 'x-auth-token': configured.apiKey });
    assert.deepEqual(input.body, { title: 'Fictional planning' });
    return { roomName: input.url.split('/').at(-1), title: input.body.title };
  }, configured);
  const result = await f.commands.create({ title: 'Fictional planning', confirm: true });
  assert.equal(result.pending.status, 'created'); assert.equal(f.requests.length, 2); assert.equal(f.writes.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /fictional-secret/);
  f.api.draft = { body: 'Keep this agenda', start: '2026-11-04T09:00:00Z' };
  await f.commands.insert({}, { editorId: 'fictional-editor' });
  assert.equal(f.writes[0].method, 'meeting.patchDraft'); assert.match(f.writes[0].input.body, /^Keep this agenda\n\nJoin KTalk: https:/);
  assert.deepEqual(Object.keys(f.writes[0].input).sort(), ['body', 'location']);
  await f.commands.create({ title: 'Duplicate', confirm: true }); assert.equal(f.requests.length, 2);
});
test('uncertain writes, invalid responses, redirects and HTTP errors never replay after restart', async () => {
  for (const failure of [{ code: 'network-unknown' }, { code: 'http-error', status: 500 }, { code: 'http-error', status: 401 }, { code: 'http-error', status: 403 }, { code: 'http-error', status: 429 }, { invalidResponse: true }]) {
    const f = await fixture(input => { if (input.method === 'GET') return notFound(); if (failure.invalidResponse) return { roomName: 'wrong' }; throw failure; }, configured);
    const result = await f.commands.create({ title: 'Fictional', confirm: true });
    assert.ok(result.error); assert.equal(f.requests.length, 2); assert.ok(f.state().pending);
    const restarted = await fixture(() => { throw new Error('Must not contact service'); }, f.state());
    assert.equal((await restarted.commands.create({ title: 'Another', confirm: true })).error, 'pending');
    assert.equal(restarted.requests.length, 0);
  }
});
test('GET failures and existing rooms never become a PUT; verification is read-only', async () => {
  for (const read of [() => ({}), () => { throw { code: 'http-error', status: 403 }; }, () => { throw { code: 'network-unknown' }; }]) {
    const f = await fixture(read, configured); await f.commands.create({ title: 'Fictional', confirm: true });
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].method, 'GET'); assert.equal(f.state().pending, undefined);
  }
  const pending = { server: configured.server, name: `aster${'a'.repeat(32)}`, title: 'Fictional', url: `${configured.server}/aster${'a'.repeat(32)}`, status: 'unknown' };
  const f = await fixture(() => ({ roomName: pending.name, title: pending.title }), { ...configured, pending });
  assert.equal((await f.commands.check()).pending.status, 'created');
  assert.equal(f.requests[0].method, 'GET');
  assert.equal((await f.commands.acknowledge({ confirm: false })).error, 'pending');
  await f.commands.acknowledge({ confirm: true }); assert.equal(f.state().pending, undefined);
});
test('corporate sessions use a host handle, never expose tokens and can be cleared', async () => {
  const f = await fixture(input => { if (input.method === 'GET') return notFound(); assert.equal(input.auth, 'session'); assert.equal(input.headers, undefined); return { roomName: input.url.split('/').at(-1), title: input.body.title }; }, { server: configured.server });
  assert.equal((await f.commands.create({ title: 'Fictional', confirm: true })).error, 'key');
  await f.commands.login();
  assert.equal((await f.commands.settings()).auth.connected, true);
  assert.equal((await f.commands.create({ title: 'Fictional', confirm: true })).pending.status, 'created');
  await f.commands.logout(); assert.equal((await f.commands.settings()).auth.connected, false);
});
test('keys stay bound to their origin and existing links preserve drafts without contacting service', async () => {
  const f = await fixture(() => { throw new Error('No network expected'); }, configured);
  const result = await f.commands.save({ server: 'app.ktalk.ru', apiKey: '' });
  assert.equal(result.hasKey, false); assert.equal(f.state().apiKey, '');
  assert.equal((await f.commands.save({ server: 'https://evil.test', apiKey: 'do-not-send' })).error, 'undeclared');
  f.api.draft = { body: 'Agenda', truncated: true };
  assert.equal((await f.commands.insert({ existing: 'https://yandex.ktalk.ru/test_room' }, { editorId: 'one' })).error, 'truncated');
  assert.equal(f.writes.length, 0);
  f.api.draft = { body: 'Agenda' };
  await f.commands.insert({ existing: 'https://yandex.ktalk.ru/test_room' }, { editorId: 'one' });
  assert.match(f.writes[0].input.body, /^Agenda\n\n/); assert.equal(f.requests.length, 0);
  await assert.rejects(f.commands.insert({ existing: 'https://evil.test/test_room' }, {}));
});
test('custom server packages contain exact reviewed origins and refuse overwriting', async t => {
  const { build } = require('../scripts/package-ktalk.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ktalk-package-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'package');
  await build({ server: 'meet.example.test', output, identityOrigins: ['https://sso.example.test'], version: '0.1.1' });
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'module.json')));
  assert.deepEqual(manifest.networkOrigins, ['https://meet.example.test']);
  assert.deepEqual(manifest.meetingLinks.origins, manifest.networkOrigins);
  assert.ok(manifest.authentication.identityOrigins.includes('https://sso.example.test'));
  assert.equal(manifest.version, '0.1.1');
  await assert.rejects(build({ server: 'meet.example.test', output, version: '0.1.1' }), { code: 'EEXIST' });
});
