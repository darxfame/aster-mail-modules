# SDK Aster Mail

Из основного репозитория скопированы:

- [architecture.md](architecture.md): устройство, безопасность и жизненный цикл.
- [development.md](development.md): API, оформление панелей, проверки и установка.
- [module.schema.json](module.schema.json): схема манифеста API 1.

Источник: [darxfame/aster-mail](https://github.com/darxfame/aster-mail/tree/a0d3cd2cc5a66840b7358592a1f4114c1c780604/docs/modules),
commit `a0d3cd2cc5a66840b7358592a1f4114c1c780604`.
Материалы перенесены и адаптированы для репозитория модулей. Пути `desktop/`, `src/`,
`scripts/` и `examples/` относятся к исходникам Aster Mail.

Схема включает декларации запуска приложения встречи и корпоративного входа,
описанные в [контракте SDK](extensions.md). Требования модуля фиксируются в каталоге.
Авторитетные проверки манифеста и пакета выполняет клиент Aster Mail;
JSON Schema не описывает все ограничения и зависимости разрешений.

Атрибуция MIT сохранена в [LICENSE](../../LICENSE).
