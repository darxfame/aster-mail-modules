import { servers } from './config.js';
import { serverOrigin, roomURL, newRoomName, draftPatch } from './core.js';

export async function activate(api) {
  const read = async () => (await api.call('storage.get')) || {};
  const save = value => api.call('storage.set', value);
  const safe = state => ({ server: state.server || servers[0], servers, hasKey: Boolean(state.apiKey), pending: state.pending || null });
  const settings = async state => ({ ...safe(state), auth: await api.call('auth.status') });
  const request = (state, name, method = 'GET', body) => api.call('network.request', {
    url: `${state.server}/api/Rooms/${name}`, method, ...(body ? { body } : {}), ...(state.apiKey ? { headers: { 'x-auth-token': state.apiKey } } : { auth: 'session' })
  });
  return { commands: {
    open: () => api.call('ui.openView', { view: 'panel' }),
    settings: async () => settings(await read()),
    login: async () => {
      const state = await read(), server = state.server || servers[0];
      if (!servers.includes(server)) return { error: 'undeclared' };
      if (!state.server) { state.server = server; await save(state); }
      await api.call('auth.signIn', { origin: server }); return settings(state);
    },
    logout: async () => { await api.call('auth.signOut'); return settings(await read()); },
    save: async input => {
      const state = await read(), server = serverOrigin(input.server);
      if (!servers.includes(server)) return { error: 'undeclared' };
      if (state.pending && state.pending.server !== server) return { error: 'pending' };
      if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey)) return { error: 'key' };
      const apiKey = input.clearKey ? '' : input.apiKey.trim() || (state.server === server ? state.apiKey || '' : '');
      await save({ ...state, server, apiKey });
      return safe({ ...state, server, apiKey });
    },
    create: async input => {
      const state = await read();
      if (state.pending) return { error: 'pending', ...safe(state) };
      const auth = await api.call('auth.status');
      if (!servers.includes(state.server) || !state.apiKey && (!auth.connected || auth.origin !== state.server)) return { error: 'key' };
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (!title || title.length > 128 || input.confirm !== true) return { error: 'title' };
      const name = newRoomName(), url = `${state.server}/${name}`;
      // The official PUT is an upsert. Never intentionally change an existing room.
      try { await request(state, name); return { error: 'collision' }; }
      catch (error) { if (error.code !== 'http-error' || error.status !== 404) return { error: 'read', status: error.status || null }; }
      state.pending = { server: state.server, name, url, title, status: 'unknown' };
      // Persist intent BEFORE writing. A crash or account retirement cannot enable replay.
      await save(state);
      let room;
      try { room = await request(state, name, 'PUT', { title }); }
      catch (error) {
        const rejected = error.code === 'http-error' && [400, 401, 403, 404, 409, 422, 429].includes(error.status);
        state.pending.status = rejected ? 'rejected' : 'unknown';
        await save(state);
        return { ...safe(state), error: rejected ? 'rejected' : 'unknown', status: error.status || null };
      }
      if (!room || room.roomName !== name || room.title !== title) return { ...safe(state), error: 'unknown' };
      state.pending.status = 'created';
      await save(state);
      return safe(state);
    },
    check: async () => {
      const state = await read(), pending = state.pending;
      if (!pending || pending.server !== state.server || !servers.includes(state.server) || !/^aster[a-f0-9]{32}$/.test(pending.name)) return { error: 'key' };
      try {
        const room = await request(state, pending.name);
        if (room?.roomName !== pending.name || room.title !== pending.title) return { ...safe(state), error: 'unknown' };
        pending.status = 'created'; await save(state); return safe(state);
      } catch (error) { return { ...safe(state), error: error.status === 404 ? 'notfound' : 'read', status: error.status || null }; }
    },
    insert: async (input, context) => {
      const state = await read();
      const url = input.existing ? roomURL(input.existing, servers) : state.pending?.status === 'created' ? roomURL(state.pending.url, servers) : null;
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
