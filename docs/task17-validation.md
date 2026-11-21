# Task 17 — результаты проверки

Дата отчёта — 21 ноября 2026, Europe/Moscow. Рабочая ветка — `codex/complete-wow-combat-simulator`. Новые изменения сохранены локально. Push, PR и merge не выполнялись.

## Итоговые проверки

| Проверка | Результат |
|---|---|
| Node.js | 288 passed, 0 failed |
| Python unittest | 88 passed |
| esbuild / npm run build | PASS |
| Chromium / WebGL2 / настоящие GLB | PASS для десяти классов и отдельных сценариев |
| Workshop и отдельный preview | PASS |
| Два мага / билды / перезапуск | PASS |
| Зависимые шаблоны и избранное / resource ID / перезапуск | PASS |
| Очередь / pushback / бесплатный cast / finisher / руны | PASS в настоящей сцене |
| Щит / отражение / bleed / cap / haste / цепочка / два крита | PASS в настоящей сцене |
| Контроль / DR / cleanse / root WASD | PASS в настоящей сцене |
| Guildhouse / текстуры / bounds / перемещение / камера | PASS на настоящих моделях |
| API / редактор роста уровня, item roll, комплект | PASS на JSON fixture |
| Оригинальный worktree и приватный asset repo | Чистые, без изменений |

Chromium использовал SwiftShader и WebGL2. Это функциональная проверка рендера и взаимодействий в облачной среде. Производительность Windows на аппаратном GPU не измерялась.

## Десять starter-классов

Для каждого прогнаны сохранение/повторная загрузка, две записи билдов, ресурс, heavy/strike/burst, shield, временный buff, proc, изученный талант, экипировка/комплект, автоатака, журнал, график и JSON. DoT/HoT/healing проверялись там, где входят в авторский starter-набор. Полная официальная точность класса этим не устанавливается.

| Класс | Способностей | Урон за сценарий | Фактическое лечение | Результат | Скриншот |
|---|---:|---:|---:|---|---|
| Рыцарь смерти | 8 | 500 | 0 | PASS | [Бой](/workspace/shared/task17/classes-final/deathknight/combat.png) |
| Друид | 9 | 499 | 231 | PASS | [Бой](/workspace/shared/task17/classes-final/druid/combat.png) |
| Охотник | 8 | 500 | 0 | PASS | [Бой](/workspace/shared/task17/classes-final/hunter/combat.png) |
| Маг | 8 | 508 | 0 | PASS | [Бой](/workspace/shared/task17/classes-final/mage/combat.png) |
| Паладин | 8 | 393 | 231 | PASS | [Бой](/workspace/shared/task17/classes-final/paladin/combat.png) |
| Жрец | 8 | 400 | 231 | PASS | [Бой](/workspace/shared/task17/classes-final/priest/combat.png) |
| Разбойник | 8 | 456 | 0 | PASS | [Бой](/workspace/shared/task17/classes-final/rogue/combat.png) |
| Шаман | 9 | 499 | 231 | PASS | [Бой](/workspace/shared/task17/classes-final/shaman/combat.png) |
| Чернокнижник | 8 | 508 | 0 | PASS | [Бой](/workspace/shared/task17/classes-final/warlock/combat.png) |
| Воин | 8 | 500 | 0 | PASS | [Бой](/workspace/shared/task17/classes-final/warrior/combat.png) |

Числа относятся к разным authored-сценариям и длительностям. Их нельзя использовать как сравнительную оценку баланса классов.

## Основные изображения

- [Ауры, урон, реальные модели и перемещённый HUD](/workspace/shared/task17/mechanics-final/02-four-aura-rails-layout.png)
- [Цепочка проков, критические эффекты и haste](/workspace/shared/task17/mechanics-final/04-procs-haste-critical.png)
- [Аналитика мага и график DPS/HPS](/workspace/shared/task17/classes-final/mage/analytics.png)
- [Редактор заклинания](/workspace/shared/task17/workshop-regression/01-spell-workshop.png)
- [Изолированный preview](/workspace/shared/task17/workshop-regression/02-live-preview.png)
- [Экипировка](/workspace/shared/task17/rpg-regression/02-equipment-editor.png)
- [Калибровка и хват оружия](/workspace/shared/task17/guildhouse-regression/03-right-hand-grip.png)
- [Коллизии guildhouse](/workspace/shared/task17/guildhouse-regression/02-guildhouse-collision-debug.png)
- [DR и снятие контроля](/workspace/shared/task17/controls-final/02-control-combat.png)
- [Изоляция зависимых шаблонов](/workspace/shared/task17/template-dependencies/01-independent-payloads.png)

## Настоящие ассеты

GLB и три внешние текстуры остаются в игнорируемой `local-assets/wow`. SHA256 четырёх GLB совпадают с Git LFS OID приватного репозитория. Сам репозиторий ассетов не изменялся.

| Файл | Байт | SHA256 |
|---|---:|---|
| character/hero.glb | 105441844 | `ee328d21599fc2167308b831e2af49d33b272bdb483a1ba79e4805cd9b4912a5` |
| targets/Training-dummy.glb | 802176 | `8a51eb177f9ed31dde1503fe5ffc754eb8abb2e588d88ecbaa20c07f77df8d3d` |
| weapons/sword-one-hand.glb | 18696 | `2593abac9cd59774e0dce6e89933d79e0efd28c70f15e11feb1af8865b51dc09` |
| world/guildhouseb.glb | 2035904 | `b854ddd8b88a7f518e1576eb9f2628a35a2b5375d7ebffa207d938025e02c729` |

Loader диагностировал текстуры environment 24, hero 5, weapon 1, target 1. Все четыре роли загружены в реальную сцену.

## Изменённые файлы Task 17

Список относительно контрольной точки изоляции `baf4687`. Включает первую контрольную точку Task 17 и финальные доработки.

- `combat_rules.py`
- `docs/ability-instance-isolation.md`
- `docs/task17-combat-audit.md`
- `docs/task17-combat-simulator.md`
- `docs/task17-validation.md`
- `rpg_profile.py`
- `server.py`
- `static/app.js`
- `static/character-lab.js`
- `static/combat-effect-editor.js`
- `static/combat/ability-instance.js`
- `static/combat/advanced-effects.js`
- `static/combat/build-snapshots.js`
- `static/combat/calculation-engine.js`
- `static/combat/character-stats.js`
- `static/combat/class-resources.js`
- `static/combat/combat-clock.js`
- `static/combat/combat-runtime.js`
- `static/combat/combat-state.js`
- `static/combat/effect-validation.js`
- `static/combat/item-roll.js`
- `static/combat/proc-engine.js`
- `static/combat/progression.js`
- `static/combat/resource-recovery.js`
- `static/combat/rpg-profile.js`
- `static/combat/rulesets.js`
- `static/combat/session-report.js`
- `static/combat/workshop-rules.js`
- `static/engine.js`
- `static/resource-costs.js`
- `static/spell-workshop.js`
- `static/training-grounds/combat-review.js`
- `static/training-grounds/floating-combat-text.js`
- `static/training-grounds/hud-layout.js`
- `static/training-grounds/training-grounds-ui.js`
- `static/training-grounds/training-grounds.js`
- `static/training-grounds/world-hud.js`
- `static/training-grounds/world-integration.js`
- `static/training-grounds/world-ui.css`
- `static/world/combat/spatial-combat.js`
- `static/world/world-engine.js`
- `tests/ability-instance.test.js`
- `tests/browser_ability_isolation.py`
- `tests/browser_cataclysm_classes.py`
- `tests/browser_cataclysm_combat.py`
- `tests/browser_control_combat.py`
- `tests/browser_rpg_combat.py`
- `tests/browser_task17_lab.py`
- `tests/browser_task17_mechanics.py`
- `tests/browser_template_dependencies.py`
- `tests/build-snapshots.test.js`
- `tests/cataclysm-rules.test.js`
- `tests/control-effects.test.js`
- `tests/progression-items.test.js`
- `tests/test_rpg_profile.py`
- `tests/test_spell_workshop.py`
- `tools/task17-class-builds.mjs`

Архитектура, все механики, частичная поддержка и ограничения описаны в [task17-combat-simulator.md](task17-combat-simulator.md). GLB, извлечённые текстуры, базы и локальные пользовательские данные в список изменений не входят.
