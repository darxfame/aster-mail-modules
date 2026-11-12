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
    if (method === 'network.requestOrigin') return { granted: new URL(input.origin).hostname.endsWith('.ktalk.ru'), origin: input.origin };
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
const configured = { server: 'https://app.ktalk.ru', apiKey: 'fictional-secret' };
// Shape observed in the public demo GET for a fresh random address (no real IDs).
const defaultRoom = name => ({ roomName: name, moderators: [], anonymousModerators: [], onlineUsers: [], sessionHalls: [], conferenceId: 'fictional-conference' });
test('server and room parsing accepts custom HTTPS and test_room but rejects escapes', async () => {
  const { serverOrigin, roomURL } = await import('../ktalk/core.js');
  assert.equal(serverOrigin('app.ktalk.ru'), 'https://app.ktalk.ru');
  assert.equal(serverOrigin('https://meet.example.test:8443'), 'https://meet.example.test:8443');
  for (const input of ['http://app.ktalk.ru', 'https://x@app.ktalk.ru', 'https://app.ktalk.ru/path', 'https://app.ktalk.ru?x=1', 'https://app.ktalk.ru\\@evil.test', 'localhost']) assert.throws(() => serverOrigin(input));
  const origins = ['https://app.ktalk.ru'];
  assert.equal(roomURL('https://app.ktalk.ru/test_room?pin=1234', origins), 'https://app.ktalk.ru/test_room?pin=1234');
  for (const input of ['ktalk://app.ktalk.ru/test_room', 'https://evil.test/test_room', 'https://app.ktalk.ru/api', 'https://app.ktalk.ru/a/b', 'https://app.ktalk.ru/%2e%2e/a']) assert.throws(() => roomURL(input, origins));
});
test('creation uses official upsert contract, persisted intent, scoped key and separate draft action', async () => {
  const f = await fixture((input, state) => {
    if (input.method === 'GET') return notFound();
    assert.equal(state.pending.status, 'unknown');
    assert.match(input.url, /^https:\/\/app.ktalk.ru\/api\/Rooms\/aster[a-f0-9]{32}$/);
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
test('SSO preflight failures explain the actual stage and HTTP status without creating a room', async () => {
  for (const language of ['ru', 'en']) {
    for (const status of [401, 403, 429, 500, null]) {
      const f = await fixture(() => { throw Object.assign(new Error('private-token private-response https://company.example.test'), { code: status ? 'http-error' : 'network-unknown', status }); }, { server: 'https://diy.ktalk.ru' });
      f.setAuth({ connected: true, origin: 'https://diy.ktalk.ru' });
      const call = f.api.call;
      f.api.call = (method, input) => method === 'ui.context' ? { language } : call(method, input);
      f.api.draft = { title: 'Fictional meeting', body: 'Preserve agenda' };
      const result = await f.commands['create-meeting-room']({}, { editorId: 'draft' });
      assert.equal(result.error, true);
      assert.match(result.message, language === 'ru' ? /Запрос создания не отправлялся/ : /No creation request was sent/);
      if (status) assert.match(result.message, new RegExp(`HTTP ${status}`));
      if (status === 403) assert.match(result.message, language === 'ru' ? /Проверьте права/ : /Check the user/);
      assert.doesNotMatch(result.message, /private-token|private-response|company\.example/);
      assert.equal(f.requests.length, 1); assert.equal(f.requests[0].method, 'GET');
      assert.equal(f.state().pending, undefined); assert.equal(f.writes.length, 0);
    }
  }
});
test('calendar distinguishes collisions, rejected creation and uncertain writes', async () => {
  for (const failure of ['collision', 403, 500, 'invalid']) {
    const f = await fixture(input => {
      if (input.method === 'GET') { if (failure === 'collision') return { ...defaultRoom(input.url.split('/').at(-1)), title: 'Existing fictional room' }; return notFound(); }
      if (failure === 'invalid') return {};
      throw { code: 'http-error', status: failure };
    }, configured);
    f.api.draft = { title: 'Fictional', body: '' };
    const result = await f.commands['create-meeting-room']({}, { editorId: 'draft' });
    assert.equal(result.error, true);
    assert.match(result.message, failure === 'collision' ? /already taken/ : failure === 403 ? /rejected the creation request/ : /Creation will not be repeated/);
    assert.doesNotMatch(result.message, /No creation request was sent/);
    assert.equal(f.writes.length, 0);
    if (failure !== 'collision') {
      assert.equal(f.state().pending.status, failure === 403 ? 'rejected' : 'unknown');
      await f.commands['create-meeting-room']({}, { editorId: 'draft' });
      assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1);
    }
  }
});
test('fresh-address GET 200 default settings permits one PUT and keeps safe durable diagnostics', async () => {
  const f = await fixture(input => input.method === 'GET' ? defaultRoom(input.url.split('/').at(-1)) : { roomName: input.url.split('/').at(-1), title: input.body.title }, configured);
  const result = await f.commands.create({ title: 'Private meeting title', confirm: true });
  assert.equal(result.pending.status, 'created');
  assert.deepEqual(f.requests.map(request => request.method), ['GET', 'PUT']);
  assert.equal(result.lastAttempt.url, result.pending.url);
  assert.equal(result.lastAttempt.check.kind, 'default'); assert.equal(result.lastAttempt.check.http, '2xx');
  assert.equal(result.lastAttempt.write.kind, 'created');
  assert.doesNotMatch(JSON.stringify(result.lastAttempt), /Private meeting title|fictional-secret|fictional-conference/);
  const restart = await fixture(() => assert.fail('No replay after restart'), f.state());
  assert.deepEqual((await restart.commands.settings()).lastAttempt, result.lastAttempt);
  assert.equal((await restart.commands.create({ title: 'Again', confirm: true })).error, 'pending');
});
test('configured, active and malformed GET 200 results block PUT and remain visible without pending state', async () => {
  for (const change of [{ title: 'Existing' }, { description: 'Private' }, { moderators: [{ key: 'private-user' }] }, { onlineUsers: [{ name: 'Private name' }] }, { anonymousModerators: ['private'] }, { sessionHalls: [{ title: 'Private' }] }, { pinCode: '1234' }, { roomStream: { isEnabled: true } }, { roomStream: { isActive: true } }, { roomStream: { viewersCount: 1 } }, { sipSettings: [] }, { roomStream: { isEnabled: 'false' } }, { roomName: 'wrong' }, { moderators: 'invalid' }]) {
    const f = await fixture(input => ({ ...defaultRoom(input.url.split('/').at(-1)), ...change }), configured);
    const result = await f.commands.create({ title: 'Fictional', confirm: true });
    assert.ok(['read', 'collision'].includes(result.error)); assert.equal(f.requests.length, 1);
    assert.equal(f.state().pending, undefined); assert.equal(result.lastAttempt.write.kind, 'not-sent');
    assert.match(result.lastAttempt.url, /\/aster[a-f0-9]{32}$/);
    assert.doesNotMatch(JSON.stringify(result.lastAttempt), /Private|private-user|1234/);
    assert.deepEqual((await f.commands.settings()).lastAttempt, result.lastAttempt);
  }
});
test('calendar accepts default SIP/disabled stream metadata and inserts only the HTTPS room URL', async () => {
  for (const metadata of [{ sipSettings: {}, roomStream: {} }, { sipSettings: { sipUri: '', sipNumber: '', phoneNumbers: [] }, roomStream: { isEnabled: false, isActive: false, viewersCount: 0 } }, { sipSettings: { sipUri: 'sip:private@fictional.test', sipNumber: 'private-number', phoneNumbers: ['private-phone'] }, roomStream: { isEnabled: false, isActive: false, viewersCount: 0, streamKey: 'private-stream-key' } }]) {
    const f = await fixture(input => input.method === 'GET' ? { ...defaultRoom(input.url.split('/').at(-1)), ...metadata } : { roomName: input.url.split('/').at(-1), title: input.body.title }, configured);
    f.api.draft = { title: 'Fictional', body: 'Keep agenda', location: '' };
    const result = await f.commands['create-meeting-room']({}, { editorId: 'calendar-editor' });
    assert.equal(result.error, undefined); assert.match(result.url, /^https:\/\/app\.ktalk\.ru\/aster[a-f0-9]{32}$/);
    assert.deepEqual(f.requests.map(request => request.method), ['GET', 'PUT']);
    assert.equal(f.writes[0].input.location, result.url); assert.match(f.writes[0].input.body, /^Keep agenda\n\nJoin KTalk: https:/);
    assert.doesNotMatch(JSON.stringify(f.state().lastAttempt), /sip:|private-number|private-phone|private-stream-key/);
    assert.doesNotMatch(JSON.stringify(f.writes), /sip:|private-/);
    assert.equal(f.state().lastAttempt.check.hasPin, false); assert.equal(f.state().lastAttempt.check.streamActive, false);
    await f.commands['create-meeting-room']({}, { editorId: 'calendar-editor' });
    assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1);
  }
});
test('diagnostics persist read failures, uncertain PUT and read-only verification without copying service errors', async () => {
  const failedRead = await fixture(() => { throw { code: 'http-error', status: 403, message: 'private-response' }; }, configured);
  const result = await failedRead.commands.create({ title: 'Fictional', confirm: true });
  assert.equal(result.lastAttempt.check.http, 403); assert.equal(result.lastAttempt.write.kind, 'not-sent');
  let verify = false;
  const f = await fixture(input => {
    if (input.method === 'PUT') throw { code: 'network-unknown', message: 'private-response' };
    const room = defaultRoom(input.url.split('/').at(-1)); return verify ? { ...room, title: 'Fictional' } : room;
  }, configured);
  assert.equal((await f.commands.create({ title: 'Fictional', confirm: true })).lastAttempt.write.kind, 'unknown');
  assert.equal((await f.commands.check()).lastAttempt.verification.kind, 'invalid');
  verify = true; assert.equal((await f.commands.check()).lastAttempt.verification.kind, 'confirmed');
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1);
  assert.doesNotMatch(JSON.stringify(f.state().lastAttempt), /private-response/);
});
test('storage failures prevent an unrecorded PUT and preserve unknown intent after a completed PUT', async () => {
  for (const failAt of [1, 2, 3, 4]) {
    const f = await fixture(input => input.method === 'GET' ? defaultRoom(input.url.split('/').at(-1)) : { roomName: input.url.split('/').at(-1), title: input.body.title }, configured);
    const call = f.api.call; let saves = 0;
    f.api.call = async (method, input) => { if (method === 'storage.set' && ++saves === failAt) throw new Error('Fictional storage failure'); return call(method, input); };
    await assert.rejects(f.commands.create({ title: 'Fictional', confirm: true }), /storage failure/);
    assert.equal(f.requests.filter(request => request.method === 'PUT').length, failAt === 4 ? 1 : 0);
    if (failAt === 4) {
      assert.equal(f.state().pending.status, 'unknown');
      const restart = await fixture(() => assert.fail('No replay'), f.state());
      assert.equal((await restart.commands.create({ title: 'Again', confirm: true })).error, 'pending');
    }
  }
});
test('corporate sessions use a host handle, never expose tokens and can be cleared', async () => {
  const f = await fixture(input => { if (input.method === 'GET') return notFound(); assert.equal(input.auth, 'session'); assert.equal(input.headers, undefined); return { roomName: input.url.split('/').at(-1), title: input.body.title }; }, { server: 'https://diy.ktalk.ru' });
  assert.equal((await f.commands.create({ title: 'Fictional', confirm: true })).error, 'key');
  await f.commands.login();
  assert.equal((await f.commands.settings()).auth.connected, true);
  assert.equal((await f.commands.create({ title: 'Fictional', confirm: true })).pending.status, 'created');
  await f.commands.logout(); assert.equal((await f.commands.settings()).auth.connected, false);
});
test('keys stay bound to their origin and existing links preserve drafts without contacting service', async () => {
  const f = await fixture(() => { throw new Error('No network expected'); }, configured);
  const result = await f.commands.save({ server: 'diy.ktalk.ru', apiKey: '' });
  assert.equal(result.hasKey, false); assert.equal(f.state().apiKey, '');
  assert.equal((await f.commands.save({ server: 'https://evil.test', apiKey: 'do-not-send' })).error, 'undeclared');
  f.api.draft = { body: 'Agenda', truncated: true };
  assert.equal((await f.commands.insert({ existing: 'https://app.ktalk.ru/test_room' }, { editorId: 'one' })).error, 'truncated');
  assert.equal(f.writes.length, 0);
  f.api.draft = { body: 'Agenda' };
  await f.commands.insert({ existing: 'https://app.ktalk.ru/test_room' }, { editorId: 'one' });
  assert.match(f.writes[0].input.body, /^Agenda\n\n/); assert.equal(f.requests.length, 0);
  await assert.rejects(f.commands.insert({ existing: 'https://evil.test/test_room' }, {}));
});
test('custom server packages contain exact reviewed origins and refuse overwriting', async t => {
  const { build } = require('../scripts/package-ktalk.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ktalk-package-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'package');
  await build({ server: 'meet.example.test', output, identityOrigins: ['https://sso.example.test'], version: '99.0.0' });
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'module.json')));
  assert.deepEqual(manifest.networkOrigins, ['https://meet.example.test']);
  assert.deepEqual(manifest.meetingLinks.origins, manifest.networkOrigins);
  assert.ok(manifest.authentication.identityOrigins.includes('https://sso.example.test'));
  assert.ok(manifest.authentication.identityOrigins.includes('https://auth.kontur.ru'));
  assert.equal(manifest.version, '99.0.0');
  await assert.rejects(build({ server: 'meet.example.test', output, version: '99.0.0' }), { code: 'EEXIST' });
});

test('custom workspace uses an exact SDK origin grant, and cancellation preserves the previous server and key', async () => {
  const f = await fixture(notFound, configured); const call = f.api.call.bind(f.api); const grants = [];
  f.api.call = async (method, input) => { if (method === 'network.requestOrigin') { grants.push(input.origin); return { granted: false }; } return call(method, input); };
  assert.equal((await f.commands.save({ server: 'diy.ktalk.ru', apiKey: 'new-fictional-key' })).error, 'undeclared');
  assert.deepEqual(f.state(), configured);
  f.api.call = async (method, input) => { if (method === 'network.requestOrigin') { grants.push(input.origin); return { granted: true, origin: input.origin }; } return call(method, input); };
  await f.commands.save({ server: 'https://diy.ktalk.ru', apiKey: 'new-fictional-key' });
  assert.equal(f.state().server, 'https://diy.ktalk.ru'); assert.equal(f.state().apiKey, 'new-fictional-key');
  assert.deepEqual(grants, ['https://diy.ktalk.ru', 'https://diy.ktalk.ru']);
});

test('one calendar button creates a room and inserts its link, with no duplicate PUT for the same editor', async () => {
  let puts = 0;
  const f = await fixture(input => {
    if (input.method === 'GET') return notFound();
    puts++; return { roomName: input.url.split('/').at(-1), title: input.body.title };
  }, configured);
  f.api.draft = { title: 'Fictional team meeting', body: 'Keep this agenda', location: '' };
  const result = await f.commands['create-meeting-room']({}, { editorId: 'draft-one' });
  assert.equal(result.error, undefined); assert.equal(puts, 1);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].input.location, result.url);
  assert.match(f.writes[0].input.body, /^Keep this agenda\n\nJoin KTalk: https:/);
  await f.commands['create-meeting-room']({}, { editorId: 'draft-one' }); assert.equal(puts, 1);
  f.api.draft = { title: 'Another meeting', body: '', location: 'Fictional office' };
  await f.commands['create-meeting-room']({}, { editorId: 'draft-two' }); assert.equal(puts, 2);
  assert.equal(f.writes.at(-1).input.location, 'Fictional office');
  assert.match(f.writes.at(-1).input.body, /Join KTalk: https:/);
});

test('calendar creation does not write without a new editor, valid draft or configured authentication', async () => {
  const f = await fixture(() => assert.fail('No service requests'), configured);
  assert.ok((await f.commands['create-meeting-room']({}, {})).error);
  f.api.draft = { body: 'Fictional', truncated: true };
  assert.ok((await f.commands['create-meeting-room']({}, { editorId: 'draft' })).error);
  const unauthenticated = await fixture(() => assert.fail('No unauthenticated request'), { server: configured.server });
  unauthenticated.api.draft = { title: 'Fictional', body: '' };
  assert.match((await unauthenticated.commands['create-meeting-room']({}, { editorId: 'draft' })).message, /sign-in/);
});

test('calendar creation never retries an uncertain write or a successful room after a failed draft delivery', async () => {
  for (const uncertain of [false, true]) {
    let puts = 0;
    const f = await fixture(input => {
      if (input.method === 'GET') return notFound();
      puts++; if (uncertain) throw { code: 'network-unknown' };
      return { roomName: input.url.split('/').at(-1), title: input.body.title };
    }, configured);
    f.api.draft = { title: 'Fictional', body: '' };
    if (uncertain) assert.ok((await f.commands['create-meeting-room']({}, { editorId: 'draft' })).error);
    else {
      const call = f.api.call;
      f.api.call = async (method, input) => { if (method === 'meeting.patchDraft') throw new Error('Retired editor'); return call(method, input); };
      await assert.rejects(f.commands['create-meeting-room']({}, { editorId: 'draft' }), /Retired/);
      f.api.call = call;
    }
    await f.commands['create-meeting-room']({}, { editorId: 'draft' }); assert.equal(puts, 1);
  }
});

test('calendar contributions contain one creation button and no settings panels or toolbar menus', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '../ktalk/module.json')));
  assert.deepEqual(manifest.commands.filter(command => command.slot !== 'internal').map(command => [command.id, command.slot]), [['create-meeting-room', 'meeting.create']]);
  assert.deepEqual(manifest.views.map(view => view.slot), ['panel']);
  assert.equal(manifest.authentication.startOrigin, 'https://app.ktalk.ru');
  assert.ok(manifest.authentication.identityOrigins.includes('https://auth.kontur.ru'));
});

test('full reset clears server, key and session only after confirmation and preserves uncertain room intent', async () => {
  const f = await fixture(() => assert.fail('Reset must not contact the service'), configured);
  f.setAuth({ connected: true, origin: configured.server });
  assert.equal((await f.commands.reset({})).error, 'confirm'); assert.deepEqual(f.state(), configured);
  const cleared = await f.commands.reset({ confirm: true });
  assert.deepEqual(f.state(), {}); assert.equal(cleared.server, ''); assert.equal(cleared.hasKey, false); assert.equal(cleared.auth.connected, false);
  assert.equal((await f.commands.login()).error, 'server');
  assert.equal((await f.commands.create({ title: 'Fictional', confirm: true })).error, 'key');
  const pending = { ...configured, pending: { status: 'unknown', url: 'https://app.ktalk.ru/fictional' } };
  const uncertain = await fixture(() => assert.fail('No uncertain write replay'), pending);
  assert.equal((await uncertain.commands.reset({ confirm: true })).error, 'pending'); assert.deepEqual(uncertain.state(), pending);
  await uncertain.commands.acknowledge({ confirm: true }); await uncertain.commands.reset({ confirm: true }); assert.deepEqual(uncertain.state(), {});
});


test('workspace SSO requires the company space and never starts general Contour account sign-in', async () => {
  const f = await fixture(() => assert.fail('No service request'), { server: 'https://app.ktalk.ru' });
  assert.equal((await f.commands.login()).error, 'workspace'); assert.equal((await f.commands.settings()).auth.connected, false);
  await f.commands.save({ server: 'company.ktalk.ru', apiKey: '' });
  await f.commands.login(); assert.equal((await f.commands.settings()).auth.origin, 'https://company.ktalk.ru');
});
