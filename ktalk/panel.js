import { translator } from './i18n.js';
const $ = selector => document.querySelector(selector);
const bridge = window.asterModule;
let tr = value => value, state = {}, busy = false;
const messages = {
  undeclared: 'Доступ к серверу не разрешён. Проверьте адрес и подтвердите разрешение в Aster Mail.',
  pending: 'Сначала завершите работу с предыдущей комнатой.',
  key: 'Введите ключ API для выбранного сервера.',
  title: 'Введите название до 128 символов и подтвердите создание.',
  collision: 'Случайный адрес уже занят. Новая комната не создана.',
  truncated: 'Описание слишком длинное или усечено. Добавьте ссылку вручную, сохранив описание.',
  unknown: 'Результат неизвестен. Проверьте комнату в Толке. Создание не повторяется.',
  rejected: 'Запрос отклонён. Проверьте ключ, его права и ограничения сервера.',
  notfound: 'Комната пока не найдена. При неизвестном результате проверьте её в Толке перед новым созданием.',
  read: 'Не удалось прочитать комнату. Проверьте подключение и права ключа.'
};
function render() {
  const auth = state.auth || {};
  $('#auth-state').textContent = auth.blockedOrigin ? `${tr('Для корпоративного входа требуется разрешить сервер в пакете:')} ${auth.blockedOrigin}` : tr(auth.pending ? 'Завершите вход в отдельном окне Толка.' : auth.connected && auth.origin === state.server ? 'Вход выполнен. Сессия хранится защищённо в Aster Mail.' : 'Для создания комнат войдите в Толк или укажите ключ API.');
  $('#key-hint').textContent = tr(state.hasKey ? 'Ключ сохранён. Оставьте поле пустым, чтобы сохранить его.' : 'Ключ нужен только для создания комнат.');
  $('#pending').hidden = !state.pending;
  $('#create').querySelector('button').disabled = busy || Boolean(state.pending);
  if (state.pending) {
    $('#room-url').value = state.pending.url;
    $('#room-state').textContent = tr(state.pending.status === 'created' ? 'Комната создана. Можно добавить ссылку во встречу.' : messages[state.pending.status] || messages.unknown);
    $('#insert').disabled = busy || state.pending.status !== 'created';
  }
}
async function run(command, input, success) {
  if (busy) return;
  busy = true; $('main').setAttribute('aria-busy', 'true');
  const controls = [...document.querySelectorAll('button,input')].map(element => [element, element.disabled]);
  for (const [element] of controls) element.disabled = true;
  $('#status').classList.remove('error'); $('#status').textContent = tr('Работаем…');
  try {
    const value = await bridge.command(command, input);
    if (value?.server) state = { ...state, ...value };
    $('#status').textContent = tr(value?.error ? messages[value.error] || messages.unknown : success || '');
    $('#status').classList.toggle('error', Boolean(value?.error));
    return value;
  } catch {
    $('#status').textContent = tr('Не удалось выполнить действие. Проверьте введённые данные и состояние модуля.');
    $('#status').classList.add('error');
    // A failed reply may follow a completed write. Reload durable intent, never retry.
    try { state = await bridge.command('settings'); } catch { /* Account may have retired. */ }
  } finally { busy = false; $('main').setAttribute('aria-busy', 'false'); for (const [element, disabled] of controls) element.disabled = disabled; render(); }
}
$('#settings').addEventListener('submit', async event => {
  event.preventDefault();
  await run('save', { server: $('#server').value, apiKey: $('#api-key').value }, 'Настройки сохранены.');
  $('#api-key').value = '';
});
$('#clear-key').addEventListener('click', async () => {
  await run('save', { server: state.server, apiKey: '', clearKey: true }, 'Настройки сохранены.'); $('#api-key').value = '';
});
$('#create').addEventListener('submit', async event => {
  event.preventDefault();
  await run('create', { title: $('#title').value, confirm: $('#confirm').checked }); $('#confirm').checked = false;
});
$('#check').addEventListener('click', () => run('check'));
$('#login').addEventListener('click', async () => {
  const value = await run('save', { server: $('#server').value, apiKey: $('#api-key').value }); $('#api-key').value = '';
  if (value && !value.error) await run('login');
});
$('#logout').addEventListener('click', () => run('logout'));
$('#insert').addEventListener('click', () => run('insert', {}, 'Предложено добавить ссылку. Проверьте форму встречи перед отправкой.'));
$('#existing').addEventListener('submit', event => { event.preventDefault(); void run('insert', { existing: $('#existing-url').value }, 'Предложено добавить ссылку. Проверьте форму встречи перед отправкой.'); });
$('#acknowledge').addEventListener('click', async () => { await run('acknowledge', { confirm: $('#ack').checked }); $('#ack').checked = false; });
try {
  const ui = await bridge.call('ui.context');
  tr = translator(ui.language); document.documentElement.lang = ui.language === 'en' ? 'en' : 'ru';
  if (['dark', 'light'].includes(ui.theme)) document.body.dataset.theme = ui.theme;
  for (const element of document.querySelectorAll('[data-text]')) element.textContent = tr(element.textContent);
  state = await bridge.command('settings');
  if (state.hasKey || state.auth?.connected) $('#connection').open = false;
  $('#server').value = state.server;
  for (const server of state.servers) { const option = document.createElement('option'); option.value = server; $('#servers').append(option); }
  render();
} catch { $('#status').textContent = tr('Не удалось выполнить действие. Проверьте введённые данные и состояние модуля.'); }
setInterval(async () => {
  if (busy || !state.auth?.pending) return;
  try { state.auth = await bridge.call('auth.status'); if (state.auth.connected && !state.auth.pending) $('#connection').open = false; render(); } catch { /* Account retirement closes this view. */ }
}, 1200);
