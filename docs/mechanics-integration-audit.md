# Актуальный аудит боевых механик

Основа — опубликованный Task 17 `ebf690cfc2ddeb429e7d553a9aef8a2ae21afc5f`. Доработка выполняется отдельно, в ветке `codex/cataclysm-mechanics-integration`, worktree `/workspace/talentforge-mechanics`. Исходные worktree, SQLite и приватный репозиторий ассетов сохраняются.

## Начальное состояние по коду

| Механика | Файлы | Текущее поведение | Тип расхождения | Исправление / проверка |
|---|---|---|---|---|
| Профили версии | combat/rulesets.js, rpg-profile.js, rpg_profile.py | Старый профиль отделён, Cata задан константами без источников | Нет подтверждённых данных | Реестр источников с commit/tag, версия и уровень применимости. Legacy регрессии |
| Основные характеристики | character-stats.js, rulesets.js | Глобальный AP primary×2, универсальное stamina×10 и интеллект/SP; мана распознаётся по ID | Частично, ошибка идентификации ресурса | Сверить модели 4.3.4, хранить семантику ресурса отдельно от произвольного ID, числовые эталоны |
| Рейтинги | rulesets.js | Только 85, manual scale остальных уровней | Нет таблиц клиента в среде | Проверить исторический SimulationCraft, не объявлять emulator доказательством Blizzard |
| Исход атаки | calculation-engine.js, combat-runtime.js | Miss/dodge/parry/glancing/block бросаются на каждый damage effect; crit отдельно; status может попасть после miss | Ошибка | Общий исход одного применения, отдельные attack types, таблица критов white/yellow, дополнительные эффекты только после успешного попадания |
| Положение | rulesets.js, spatial-combat.js, world-engine.js | front/behind в профиле независимо от положения героя | Ошибка интеграции | Контекст цели из геометрии при контакте, журнал фактической стороны |
| Оружие | training-grounds.js, character-stats.js, combat-runtime.js | Руки независимы, offhand×0.5; weapon scaling часто выбирает ranged из-за типа presentation; AP к white swing не подключён | Частично, ошибка | Явная рука/вид weapon scaling, AP/14×speed, normalization и правила dual wield, editor/roundtrip/реальные удары |
| Автоатака и FPS | auto-attack.js, training-grounds.js | due=now+interval; пропускает просроченные swings | Ошибка времени | Планировать и обрабатывать границы в общем runtime clock. Сравнить редкие/частые кадры с одинаковым seed |
| Cast/channel | combat-runtime.js | Оплата при finish/первом tick, GCD cast на старте; tick-channel GCD при первом тике, очередь выполняет availability заново | Частично | Единые моменты старта/оплаты и исключения, каналы без двойной оплаты, queue revalidation |
| Группы cooldown | workshop-rules.js, runtime, редактор | Индивидуальные cooldown и заряды есть, shared group нет | Механика отсутствует | Опциональная группа/время в существующем Workshop, валидаторы, HUD и бой |
| Выпущенные снаряды | runtime pending, spatial flights | Reset очищает pending, обычная отмена cast не удаляет выпущенный снаряд; смерть игрока не проверяется в callback | Частично / политика не описана | Явные правила сохранения/инвалидации снарядов, generation при reset/смене билда, тест delayed contact |
| Периодические ауры | active-effects.js, runtime | До- и после-expiry тики, refresh сохраняет nextTick даже при замене haste-интервала; один тип snapshot | Частично | Явная политика refresh/tick/snapshot, корректная последняя граница, без дублирования тиков |
| Исключение баффов | active-effects.js | Только один ability/effect; чужие аналогичные баффы складываются | Механика отсутствует | Настраиваемая исключающая категория и правило замещения |
| Dispel / иммунитет | advanced-effects.js, runtime | Категория и remove flags есть; immunity проверяется в damage, но не в наложении hostile control/status | Ошибка | Проверять иммунитет общего боевого применения и школьную принадлежность дополнительных эффектов |
| Ресурсы / руны | class-resources.js, resource-recovery.js, runtime | Произвольные шкалы, regen/decay, typed pairs. Rune haste фиксируется при расходе, conversion отсутствует | Частично | Явные определения ресурсов и авторские преобразования; Cata-политики только по подтверждённым данным |
| Проки | proc-engine.js | Chance/ICD/chain/charges/filters есть; PPM нет, consecutive reset происходит до school filter | Отсутствие / ошибка | Условия по событиям/талантам/ауре, PPM с явным временем оружия, reset счётчика только на подходящем событии |
| Искусность | character-stats.js, Character Lab | Rating показывается, универсальный Cata-множитель отключён, настроить scaling mastery нельзя | Механика отсутствует в конструкторе | Авторское scaling от mastery points через существующие bonuses, с выбранной специализацией/школой/способностью |
| Статусы официального каталога | preset-spells.js, app.js | Наличие описания/пустые effects не объясняются одинаково во всех входах | Частично | Понятное различие исполняемой механики, описания и ограничений сущностей |
| Изоляция | ability-instance.js, build-snapshots.js | UUID, transitive payloads, snapshots и миграция; старые unowned local templates назначаются первому login | Эвристика миграции | Сохранить данные и проверки 500/150, перенос ресурсов, nested payloads, restart. Проверить новые поля во всех копиях |
| Incoming стенд | runtime incoming, Character Lab | Удары по интервалу и вручную; тестового cast манекена нет | Механика отсутствует | Включаемый scripted cast той же цели для interrupt, без AI и новой сущности |
| Журнал / HUD | session-report.js, training-grounds-ui.js | Итоги есть, контекст руки/таблицы/источника версии отсутствует | Частично | Сохранять единственный результат и его breakdown, не пересчитывать в HUD/FX |

## Порядок

Аудит и источники → математика → combat clock / применение → ауры / ресурсы / проки → авторские настройки и валидаторы → геометрия арены → end-to-end / регрессии. После аудита выполняется реализация.

Клиентских DBC 4.3.4 в доступных каталогах не обнаружено. Существующий tools/cata_dbc.py указывает на отсутствующий work/sources/dbc434. Приватный репозиторий содержит модели/текстуры, не таблицы combat ratings. Формулы будут помечаться по степени подтверждения. Исторические реализации служат независимыми точками сверки.

## Результат после реализации

Продолжение аудита доведено до редакторов, серверных валидаторов, выбранного build, настоящей арены и журнала. Итоговая матрица исправлений, выполненные проверки и конкретные неподтверждённые пункты: [cataclysm-mechanics-integration.md](cataclysm-mechanics-integration.md). Отдельно исправлены реальная ось лица манекена +X, отсутствие invalidation статистик после reset формы и различение ability/group cooldown completion для проков и аналитики.
