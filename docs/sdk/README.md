# SDK Aster Mail

Из основного репозитория скопированы:

- [architecture.md](architecture.md): устройство, безопасность и жизненный цикл.
- [development.md](development.md): API, оформление панелей, проверки и установка.
- [module.schema.json](module.schema.json): схема манифеста API 1.

Источник: [darxfame/aster-mail](https://github.com/darxfame/aster-mail/tree/a0d3cd2cc5a66840b7358592a1f4114c1c780604/docs/modules),
ветка `codex/modules`, commit `a0d3cd2cc5a66840b7358592a1f4114c1c780604`.
Текстовые руководства скопированы без изменений; фраза «Толк не реализован»
относится к этому историческому снимку. Модуль теперь находится в этом репозитории.
Пути `desktop/`, `src/`, `scripts/`, `examples/` и снимки интерфейса относятся
к исходному репозиторию Aster Mail.

Схема дополнена декларациями `meeting.launch` и `auth.session` из
[расширения SDK](extensions.md). Патч host и его проверки включены в `host/`.
Одной схемы для исполнения недостаточно. Проверка манифеста и пакета в host
авторитетна: JSON Schema не описывает все ограничения и зависимости разрешений.
Актуальные правила рабочей копии Aster Mail имеют приоритет над этим снимком.

Атрибуция MIT сохранена в [LICENSE](../../LICENSE).
