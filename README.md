# Aster Mail Modules

Официальный источник модулей от [darxfame](https://github.com/darxfame), автора
[Aster Mail](https://github.com/darxfame/aster-mail). В этот же репозиторий можно
предложить собственные модули через pull request: [правила участия](CONTRIBUTING.md).

Исходный проект: [darxfame/aster-mail](https://github.com/darxfame/aster-mail).

## Локальная работа

Рекомендуемое расположение — `owamail/aster-mail-modules/`, внутри рабочей
копии Aster Mail. Это позволяет одновременно читать актуальные правила
`../AGENTS.md`, реализацию в `../desktop/` и `../src/`, а также тесты в `../test/`.

У этой папки собственная Git-история и remote. Выполняйте Git-команды для модулей
из этой папки. Родительский проект исключает её через `.gitignore`.

Перед реализацией модуля прочитайте `AGENTS.md` этого репозитория и актуальные
правила Aster Mail. Изменения основного приложения оформляйте отдельно в его
репозитории. После отдельного клонирования разместите рабочую копию Aster Mail
рядом и явно укажите путь к ней.

## Модули и подключение

| Папка | Назначение |
| --- | --- |
| [ktalk](ktalk/README.md) | Корпоративный вход, создание комнат, свой сервер, ссылки в черновике, запуск десктопного Толка |

Нужна ветка `codex/modules` Aster Mail с [расширением SDK](docs/sdk/extensions.md).
В `main` и стабильной версии `0.1.33` платформы модулей ещё нет. Пакет Толка требует
возможностей `meeting.launch` и `auth.session`; старый host отклонит его манифест.

В совместимой сборке: «Настройки → Модули → Подключить с GitHub»:

- Репозиторий: `https://github.com/darxfame/aster-mail-modules`.
- Ref: `v0.1.1` или полный commit SHA.
- Папка пакета: `ktalk`.

Проверьте commit, fingerprint, разрешения и серверы; установите пакет и отдельно
включите для нужного аккаунта. Секреты сохраняются в зашифрованном account-local
хранилище самого Aster Mail. GitHub-установка не запускает npm или скрипты сборки.

## SDK и проверка

- [Контракт каталога catalog.json](docs/CATALOG.md) и [JSON Schema](catalog.schema.json).
- [Происхождение документации](docs/sdk/README.md).
- [Устройство API 1](docs/sdk/architecture.md).
- [Разработка, оформление и подключение](docs/sdk/development.md).
- [Запуск приложения и корпоративный вход](docs/sdk/extensions.md).

Зависимости для Node-проверок не нужны:

```sh
npm run check
npm test
```

Для проверки через совместимый host и настоящий Electron:

```sh
ASTER_MAIL_HOST=/path/to/aster-modules-checkout npm run check
ASTER_MAIL_HOST=/path/to/aster-modules-checkout /path/to/aster-modules-checkout/node_modules/.bin/electron scripts/test-native.cjs
```

Нативные проверки используют временный профиль, вымышленные данные и перехваченный
сервис. Реальные корпоративные аккаунты, комнаты и приглашения не используются.
SSO конкретной организации и Windows требуют отдельной проверки.

Код и документация: [MIT](LICENSE).
