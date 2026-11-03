# Расширения SDK для Толка

База — Aster Mail `codex/modules`, commit `b8941eca23737b987909a730131d7853ca39d82a`.
Изменения подготовлены в этой ветке локально; в `main` они не переносятся.
Публикуемый в `host/ktalk-sdk.patch` патч включает реализацию и Node-проверки.
Он нужен до установки пакета `ktalk`: старый валидатор отклонит новые декларации.

Для другой рабочей копии совместимой базы:

```sh
git apply --check /path/to/aster-mail-modules/host/ktalk-sdk.patch
git apply /path/to/aster-mail-modules/host/ktalk-sdk.patch
npm run check
npm test
npm run test:modules
npm run test:connection
```

Не применяйте патч повторно в рабочей копии, где изменения уже есть. Перед production
нужны независимый review границ host и приёмка Windows/macOS. SDK остаётся API 1
с дополнительными явно объявленными возможностями; это не совместимость со старым
host. Статус реальной корпоративной аутентификации указан в README модуля.

## Десктопное приложение

Manifest: право `meeting.launch` и

```json
{
  "meetingLinks": {
    "scheme": "ktalk",
    "origins": ["https://yandex.ktalk.ru"]
  }
}
```

Host использует эту декларацию только из доверенных обработчиков пользовательского
нажатия «Подключиться»: карточка встречи и виджет. Только включённый пакет с проверенным
digest может заменить HTTPS-ссылку совпадающего origin и одночастного пути комнаты
на `ktalk://…`. Query/fragment сохраняются. Для другого сервиса остаётся обычная ссылка.
Пакет не получает shell, произвольный protocol handler, путь к приложению или RPC
запуска. Разрешена только проверенная схема `ktalk`. Если приложение не установлено,
выдаётся ошибка без скрытого открытия второго адреса. После ожидания повторно
проверяются аккаунт, включённость и digest пакета.

## Корпоративный вход

Manifest: право `auth.session` вместе с `network` и

```json
{
  "authentication": {
    "type": "ktalk-session",
    "origins": ["https://yandex.ktalk.ru"],
    "identityOrigins": ["https://passport.skbkontur.ru", "https://identity.kontur.ru"]
  }
}
```

Origins пространства должны входить в `networkOrigins`. Все origins точные, HTTPS,
без wildcard. Они показываются до установки/включения.

| SDK | Результат |
| --- | --- |
| `auth.signIn`, `{origin}` | Во время пользовательской команды открывает изолированное окно. Возвращает состояние сразу; не ждёт завершения SSO |
| `auth.status`, `{}` | `{connected,origin,expiresAt,pending,blockedOrigin}` без токена |
| `auth.signOut`, `{}` | Во время команды закрывает вход и удаляет локальную сессию этого модуля |
| `network.request`, `{url,auth:"session",…}` | Host подставляет сохранённую сессию только в запрос того же origin |

Сессия принадлежит модулю и аккаунту. В records хранится отдельное поле `auth` внутри
существующего зашифрованного LocalStore. `storage.get`, catalog и ответы SDK токен
не возвращают. Одновременно с `auth:"session"` нельзя передавать Bearer/custom headers;
нет переноса cookie/NTLM/Exchange credentials. Истёкшая сессия отклоняется без retry.

Окно не имеет module preload, Node или доступа к DOM Aster. HTTPS-переходы и popups
ограничены объявленными пространствами и IdP; максимум три окна, пять минут,
без загрузок, webview и разрешений камеры/микрофона. TLS-валидация остаётся стандартной.
Host считывает только `localStorage.session.data` в isolated world на точном origin
Толка и проверяет token/expiresAt/anonymous. Этот узкий адаптер привязан к формату
веб-клиента Толка; он не является общим OAuth API. После успеха/отмены данные session
очищаются; отключение/смена аккаунта закрывает вход и блокирует позднее сохранение.

## Коды ошибок через Electron

`contextBridge` не сохраняет custom properties объектов Error. Preload теперь
предоставляет `request(method,input)` с JSON-envelope `{ok,value}` либо
`{ok:false,error,code,status}`. Доверенный module runtime восстанавливает ошибку
в мире модуля. Контракт `api.call` сохранён; реальные 404/401 и `network-unknown`
теперь различимы. Старые `window.asterModule.call/command` доступны для совместимости;
UI, которому нужны коды ошибок, может использовать envelope `request`.
