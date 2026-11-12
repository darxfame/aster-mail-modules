import { translator, roomError, inspectionText } from './i18n.js';
const $ = selector => document.querySelector(selector);
const bridge = window.asterModule;
let tr = value => value, state = {}, busy = false;
const messages = {
  workspace: 'Для корпоративного SSO укажите адрес пространства компании, например company.ktalk.ru.',
  server: 'Сначала укажите сервер пространства Толка.',
  confirm: 'Подтвердите полный сброс настроек.',
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
  $('#auth-state').textContent = auth.blockedOrigin ? `${tr('Этот сервер входа не поддержан версией модуля. Обновите модуль или сообщите его разработчику:')} ${auth.blockedOrigin}` : tr(auth.pending ? 'Завершите вход в отдельном окне Толка.' : auth.connected && auth.origin === state.server ? 'Сессия сохранена. Права на создание комнат проверяются отдельно.' : 'Для создания комнат войдите в Толк или укажите ключ API.');
  $('#key-hint').textContent = tr(state.hasKey ? 'Ключ сохранён. Оставьте поле пустым, чтобы сохранить его.' : 'Ключ нужен только для создания комнат.');
  $('#clear-key').disabled = !state.hasKey;
  $('#logout').disabled = !auth.connected && !auth.pending;
  $('#last-attempt').hidden = !state.lastAttempt;
  if (state.lastAttempt) {
    $('#attempt-url').value = state.lastAttempt.url;
    const date = new Date(state.lastAttempt.at);
    $('#attempt-time').textContent = Number.isFinite(date.getTime()) ? date.toLocaleString(document.documentElement.lang) : '';
    $('#attempt-check').textContent = `${tr('Проверка GET')}: ${inspectionText(state.lastAttempt.check, tr)}`;
    $('#attempt-write').textContent = `${tr('Создание PUT')}: ${inspectionText(state.lastAttempt.write, tr)}`;
    $('#attempt-verification').hidden = !state.lastAttempt.verification;
    $('#attempt-verification').textContent = `${tr('Повторная проверка GET')}: ${inspectionText(state.lastAttempt.verification, tr)}`;
  }
  $('#pending').hidden = !state.pending;
  if (state.pending) {
    $('#room-url').value = state.pending.url;
    $('#room-state').textContent = tr(state.pending.status === 'created' ? 'Комната создана. Ссылку можно скопировать.' : messages[state.pending.status] || messages.unknown);
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
    if (typeof value?.server === 'string') state = { ...state, ...value };
    $('#status').textContent = value?.error && value.stage === 'check' ? roomError(value, tr) : tr(value?.error ? messages[value.error] || messages.unknown : success || '');
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
$('#check').addEventListener('click', () => run('check'));
$('#login').addEventListener('click', async () => {
  if (!$('#settings').reportValidity()) return;
  const value = await run('save', { server: $('#server').value, apiKey: $('#api-key').value }); $('#api-key').value = '';
  if (value && !value.error) await run('login');
});
$('#logout').addEventListener('click', () => run('logout'));
$('#reset').addEventListener('click', async () => {
  if ($('#reset').dataset.confirmed !== 'true') {
    $('#reset').dataset.confirmed = 'true'; $('#reset').textContent = tr('Подтвердить полный сброс');
    $('#status').textContent = tr('Будут удалены сервер, API-ключ, сессия и настройки комнат. Комнаты на сервере сохранятся.'); return;
  }
  const value = await run('reset', { confirm: true }, 'Настройки Толка очищены.');
  if (value && !value.error) { $('#server').value = ''; $('#api-key').value = ''; $('#ack').checked = false; }
  delete $('#reset').dataset.confirmed; $('#reset').textContent = tr('Сбросить все настройки Толка');
});
$('#acknowledge').addEventListener('click', async () => { await run('acknowledge', { confirm: $('#ack').checked }); $('#ack').checked = false; });
try {
  const ui = await bridge.call('ui.context');
  tr = translator(ui.language); document.documentElement.lang = ui.language === 'en' ? 'en' : 'ru';
  if (['dark', 'light'].includes(ui.theme)) document.body.dataset.theme = ui.theme;
  for (const element of document.querySelectorAll('[data-text]')) element.textContent = tr(element.textContent);
  state = await bridge.command('settings');
  $('#server').value = state.server;
  for (const server of state.servers.filter(value => value !== 'https://app.ktalk.ru')) { const option = document.createElement('option'); option.value = server; $('#servers').append(option); }
  render();
} catch { $('#status').textContent = tr('Не удалось выполнить действие. Проверьте введённые данные и состояние модуля.'); }
setInterval(async () => {
  if (busy || !state.auth?.pending) return;
  try { state.auth = await bridge.call('auth.status'); if (state.auth.connected && !state.auth.pending) $('#connection').open = false; render(); } catch { /* Account retirement closes this view. */ }
}, 1200);
