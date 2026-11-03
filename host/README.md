# Расширение host Aster Mail

`ktalk-sdk.patch` — отдельное изменение ветки `codex/modules` для `meeting.launch`,
`auth.session` и сохранения кодов ошибок через Electron contextBridge.
Базовый commit и SHA-256 самого патча зафиксированы в `provenance.json`.
Это SHA-256 файла патча, не fingerprint пакета Толка и не запись каталога.

Патч проверен через `git apply --check` на чистой копии указанного baseCommit.
Исходники модуля остаются в `ktalk/`, исходники host — в основном репозитории.
Применение не переносит изменения в `main` и не публикует новую сборку приложения.
Инструкции и границы: [SDK extensions](../docs/sdk/extensions.md).

`desktop/modules.cjs` экспортирует `features`: `meeting.launch`, `auth.ktalk-session`,
`rpc.error-details`. Клиент каталога должен сравнивать их с `host.features` записи
до установки, помимо повторной проверки fingerprint, manifest и разрешений.
