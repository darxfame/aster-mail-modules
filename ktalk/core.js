export function serverOrigin(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\s\\]/.test(value)) throw new Error('server');
  if (!/^https:\/\/[^/?#]+\/?$/i.test(value.includes('://') ? value : `https://${value}`)) throw new Error('server');
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname)) throw new Error('server');
  return url.origin;
}

export function roomURL(value, origins) {
  if (typeof value !== 'string' || value.length > 2000 || /[\s\\]/.test(value)) throw new Error('room');
  if (!/^https:\/\/[^/?#]+\/[a-z0-9_-]{1,200}\/?(?:[?#]|$)/i.test(value)) throw new Error('room');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !origins.includes(url.origin) || !/^\/[a-z0-9_-]{1,200}\/?$/i.test(url.pathname) || /^\/(?:api|auth|login|download|settings|admin|oauth|calendar)\/?$/i.test(url.pathname)) throw new Error('room');
  return url.href;
}

export function newRoomName() {
  return `aster${crypto.randomUUID().replaceAll('-', '')}`;
}

// GET returns default settings for a fresh address, not necessarily a 404.
// Record only flags/counts, never names, titles, participant data or service IDs.
export function inspectRoom(room, name) {
  if (!room || typeof room !== 'object' || Array.isArray(room) || room.roomName !== name) return { kind: 'invalid' };
  if (['title', 'description', 'pinCode'].some(key => room[key] != null && typeof room[key] !== 'string')) return { kind: 'invalid' };
  const lists = ['moderators', 'anonymousModerators', 'onlineUsers', 'sessionHalls'];
  if (lists.some(key => !Array.isArray(room[key]))) return { kind: 'invalid' };
  const summary = {
    hasTitle: Boolean(room.title), hasDescription: Boolean(room.description),
    moderators: room.moderators.length + room.anonymousModerators.length,
    users: room.onlineUsers.length, halls: room.sessionHalls.length,
    protected: Boolean(room.pinCode || room.sipSettings || room.roomStream)
  };
  const configured = summary.hasTitle || summary.hasDescription || summary.moderators || summary.users || summary.halls || summary.protected;
  return { kind: configured ? 'configured' : 'default', ...summary };
}

export function draftPatch(draft, url, label) {
  // Preserve the current description, including manually typed non-KTalk links.
  if (draft?.truncated) throw new Error('truncated');
  const body = draft?.body || '';
  const updated = body.includes(url) ? body : `${body}${body ? '\n\n' : ''}${label}: ${url}`;
  if (updated.length > 8000) throw new Error('truncated');
  return { location: draft?.location || url, body: updated };
}
