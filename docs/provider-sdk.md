# Интеграция провайдеров с общим SDK

Общие возможности входа и открытия desktop-приложения разрабатываются в ветке
`codex/module-catalog` Aster Mail. Реализация конкретного провайдера остаётся
в этом репозитории. До слияния изменений SDK не объявляйте совместимость с
основной версией клиента и не включайте пакет в одобренный каталог.

## Перенос экспериментального адаптера входа

Вместо типа, привязанного к названию провайдера, используется `browser-token`.
Для session envelope формата `{data:{token,expiresAt,anonymous}}` декларация:

```json
{
  "authentication": {
    "type": "browser-token",
    "origins": ["https://service.example.test"],
    "identityOrigins": ["https://identity.example.test"],
    "capture": {
      "storage": "localStorage",
      "key": "session",
      "tokenPath": ["data", "token"],
      "expiresAtPath": ["data", "expiresAt"],
      "rejectPath": ["data", "anonymous"]
    },
    "authorization": { "scheme": "Session" }
  }
}
```

Подставляются реальные точные HTTPS origins провайдера. Они и scheme desktop
приложения задаются его manifest, без if/ветвлений по имени сервиса в Aster.
`auth.signIn`, `auth.status`, `auth.signOut` и `network.request({auth:'session'})`
сохраняют общие имена. Проверьте, что формат ответа и expiry соответствует
фактическому сервису; тесты host на вымышленном login не доказывают совместимость
конкретного сервиса.

Для встреч используется общая декларация `meetingLinks: {scheme, origins}` и
право `meeting.launch`. Host проверяет origin, простой путь и установленный
системный обработчик; не принимает команды/пути исполняемых файлов. Пользователь
видит приложение и ссылку до открытия. Если SDK не покрывает нужный URI-формат,
сначала предложите общий контракт с тестами, не переносите сервисный код в host.

Пакет проходит review и публикуется отдельным коммитом, затем его SHA, manifest
и digest добавляются в каталог согласно [catalog.md](catalog.md).
