import { servers } from './config.js';
import { translator, roomError } from './i18n.js';
import { serverOrigin, roomURL, newRoomName, draftPatch, inspectRoom } from './core.js';

export async function activate(api) {
  const read = async () => (await api.call('storage.get')) || {};
  const save = value => api.call('storage.set', value);
  const safe = state => ({ server: state.server || '', servers, hasKey: Boolean(state.apiKey), pending: state.pending || null, lastAttempt: state.lastAttempt || null });
  const settings = async state => ({ ...safe(state), auth: await api.call('auth.status') });
  const request = (state, name, method = 'GET', body) => api.call('network.request', {
    url: `${state.server}/api/Rooms/${name}`, method, ...(body ? { body } : {}), ...(state.apiKey ? { headers: { 'x-auth-token': state.apiKey } } : { auth: 'session' })
  });
  const createRoom = async input => {
    const state = await read();
    if (state.pending) return { error: 'pending', ...safe(state) };
    const auth = await api.call('auth.status');
    if (!state.server || !state.apiKey && (!auth.connected || auth.origin !== state.server)) return { error: 'key' };
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 128 || input.confirm !== true) return { error: 'title' };
    const name = newRoomName(), url = `${state.server}/${name}`;
    state.lastAttempt = { url, at: new Date().toISOString(), check: { kind: 'checking' }, write: { kind: 'not-sent' } };
    await save(state);
    // PUT is an upsert. Use only our new random UUID, and reject visible existing
    // configuration/activity. Default GET settings are not evidence of a collision.
    try { state.lastAttempt.check = { ...inspectRoom(await request(state, name), name), http: '2xx' }; }
    catch (error) { state.lastAttempt.check = { kind: error.code === 'http-error' && error.status === 404 ? 'missing' : 'failed', ...(Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? { http: error.status } : {}) }; }
    await save(state);
    if (state.lastAttempt.check.kind === 'configured') return { ...safe(state), error: 'collision' };
    if (!['default', 'missing'].includes(state.lastAttempt.check.kind)) return { ...safe(state), error: 'read', stage: 'check', status: state.lastAttempt.check.http, invalid: state.lastAttempt.check.kind === 'invalid' };
    state.pending = { server: state.server, name, url, title, status: 'unknown', ...(input.editorId ? { editorId: input.editorId } : {}) };
    state.lastAttempt.write = { kind: 'unknown' };
    // Persist intent BEFORE writing. A crash or account retirement cannot enable replay.
    await save(state);
    let room;
    try { room = await request(state, name, 'PUT', { title }); }
    catch (error) {
      const rejected = error.code === 'http-error' && [400, 401, 403, 404, 409, 422, 429].includes(error.status);
      state.pending.status = rejected ? 'rejected' : 'unknown';
      state.lastAttempt.write = { kind: state.pending.status, ...(Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? { http: error.status } : {}) };
      await save(state);
      return { ...safe(state), error: rejected ? 'rejected' : 'unknown', status: error.status || null };
    }
    state.lastAttempt.write = { kind: room?.roomName === name && room.title === title ? 'created' : 'invalid', http: '2xx' };
    if (state.lastAttempt.write.kind !== 'created') { await save(state); return { ...safe(state), error: 'unknown' }; }
    state.pending.status = 'created';
    await save(state);
    return safe(state);
  };
  return { commands: {
    settings: async () => settings(await read()),
    login: async () => {
      const state = await read(), server = state.server;
      if (!server) return { error: 'server' };
      if (server === 'https://app.ktalk.ru') return { error: 'workspace' };
      if (!servers.includes(server) && !(await api.call('network.requestOrigin', { origin: server })).granted) return { error: 'undeclared' };
      await api.call('auth.signIn', { origin: server }); return settings(state);
    },
    logout: async () => { await api.call('auth.signOut'); return settings(await read()); },
    reset: async input => {
      const state = await read();
      if (input.confirm !== true) return { error: 'confirm' };
      if (state.pending && state.pending.status !== 'created') return { error: 'pending', ...safe(state) };
      await api.call('auth.signOut'); await save({}); return settings({});
    },
    save: async input => {
      const state = await read(), server = serverOrigin(input.server);
      if (state.pending && state.pending.server !== server) return { error: 'pending' };
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) return { error: 'key' };
      if (!servers.includes(server) && !(await api.call('network.requestOrigin', { origin: server })).granted) return { error: 'undeclared' };
      const apiKey = input.clearKey ? '' : input.apiKey.trim() || (state.server === server ? state.apiKey || '' : '');
      await save({ ...state, server, apiKey });
      return safe({ ...state, server, apiKey });
    },
    create: createRoom,
    'create-meeting-room': async (_input, context) => {
      const tr = translator((await api.call('ui.context')).language);
      const fail = message => ({ message: tr(message), error: true });
      if (!context?.editorId) return fail('Откройте новую встречу, чтобы создать комнату.');
      const draft = await api.call('meeting.getDraft');
      if (draft.truncated || (draft.body || '').length > 7600) return fail('Описание слишком длинное. Добавьте ссылку вручную в настройках модуля.');
      const state = await read();
      if (state.pending && state.pending.status !== 'created') return fail('Результат предыдущего создания не подтверждён. Проверьте комнату в настройках модуля.');
      let result;
      if (state.pending && (!state.pending.editorId || state.pending.editorId === context.editorId)) result = safe(state);
      else {
        if (state.pending) { delete state.pending; await save(state); }
        result = await createRoom({ title: ((draft.title || '').trim() || tr('Новая встреча')).slice(0, 128), confirm: true, editorId: context.editorId });
      }
      if (result.error) return result.error === 'key' ? fail('Сначала настройте вход в Толк в разделе «Модули».') : { message: roomError(result, tr), error: true };
      // The host rejects stale editors and asks before replacing newer field values.
      let patch;
      try { patch = draftPatch(draft, result.pending.url, tr('Подключиться в Толке')); }
      catch { return fail('Описание слишком длинное. Добавьте ссылку вручную в настройках модуля.'); }
      await api.call('meeting.patchDraft', patch);
      const current = await read();
      current.pending.editorId = context.editorId; await save(current);
      return { message: tr('Ссылка на комнату добавлена в новую встречу.'), url: result.pending.url };
    },
    check: async () => {
      const state = await read(), pending = state.pending;
      if (!pending || pending.server !== state.server || !state.server || !/^aster[a-f0-9]{32}$/.test(pending.name)) return { error: 'key' };
      try {
        const room = await request(state, pending.name);
        state.lastAttempt ||= { url: pending.url, at: new Date().toISOString() };
        state.lastAttempt.verification = { kind: room?.roomName === pending.name && room.title === pending.title ? 'confirmed' : 'invalid', http: '2xx' };
        if (state.lastAttempt.verification.kind !== 'confirmed') { await save(state); return { ...safe(state), error: 'unknown' }; }
        pending.status = 'created'; await save(state); return safe(state);
      } catch (error) {
        state.lastAttempt ||= { url: pending.url, at: new Date().toISOString() };
        state.lastAttempt.verification = { kind: 'failed', ...(Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? { http: error.status } : {}) };
        await save(state);
        return { ...safe(state), error: error.status === 404 ? 'notfound' : 'read', status: error.status || null };
      }
    },
    insert: async (input, context) => {
      const state = await read();
      const url = input.existing ? roomURL(input.existing, [...new Set([...servers, state.server].filter(Boolean))]) : state.pending?.status === 'created' ? roomURL(state.pending.url, [...new Set([...servers, state.server].filter(Boolean))]) : null;
      if (!url) return { error: 'unknown' };
      const draft = context?.editorId ? await api.call('meeting.getDraft') : {};
      const ui = await api.call('ui.context');
      let patch;
      try { patch = draftPatch(draft, url, ui.language === 'en' ? 'Join KTalk' : 'Подключиться в Толке'); }
      catch { return { error: 'truncated' }; }
      await api.call(context?.editorId ? 'meeting.patchDraft' : 'meeting.openDraft', patch);
      return { offered: true, url };
    },
    acknowledge: async input => {
      const state = await read();
      if (input.confirm !== true) return { error: 'pending' };
      // Explicitly discard the local workflow only; never delete/retry a remote room.
      delete state.pending; await save(state); return safe(state);
    }
  } };
}
