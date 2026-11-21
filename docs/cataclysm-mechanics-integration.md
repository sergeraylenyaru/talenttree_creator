# Конструктор боевых механик: результат интеграции

Основа: Task 17 `ebf690cfc2ddeb429e7d553a9aef8a2ae21afc5f`. Ветка: `codex/cataclysm-mechanics-integration`. Работа выполнена в отдельном worktree. Публикация, PR и merge не выполняются.

Игра сохраняет одного управляемого героя и один манекен в прежней арене. Сценарий входящего cast — функция того же манекена; дополнительного AI или сущности нет. Официальный каталог оценивается отдельно от возможностей пользовательского конструктора.

## Реализовано

| Область | Изменение | Проверка |
|---|---|---|
| Attack table | Раздельные melee/ranged/spell, white one-roll crit, special second-roll crit, miss/avoid/glancing, dual-wield penalty | Независимые числовые эталоны, multi-component miss без наложения debuff или hit resource |
| Оружие | Явная рука, AP/14 × speed, normalized speed, offhand component; white swing использует AP | Числа 143 / 134 / 30 в контрольном наборе; две руки в журнале настоящей арены (визуально — один поставленный меч) |
| Броня и HP | Armor K на границах 59/60/80/81/85; stamina 14 HP после первых 20 на 85 | Независимые числовые ожидания; старый профиль отдельно |
| Единый исход | Общий исход damage components / hostile aura, иммунитеты дополнительных эффектов; onHit gain один раз | Тесты промаха, двух компонентов, журнала и ресурсов |
| Общий Combat Clock | Main/off swing и spatial deadlines; проектиль шагом 1/120 боевой секунды; timestamp контакта принадлежит runtime | Один большой advance и много малых дают одинаковые события, seed и оплату |
| Cast/channel | Cata GCD в начале подготовки/канала; ticked channel оплачивается в начале, legacy — на первом тике; выбор payment policy | Отмена до первого тика, одна оплата, отсутствие поздних тиков |
| Cooldown | Общие группы, длительность группы, opt-in reset/reduction группы | Другая способность блокируется; клиент/сервер и арена |
| Автоатака | Сохранение пропущенных deadlines; ожидание вне радиуса без накопления ударов; continue/pause/reset во время cast; retime haste | Main/off clock, pause/reset/haste, настоящий меч в арене |
| Периодические эффекты | Preserve/restart ближайшего тика независимо от refresh duration; existing snapshot | Последний тик, clipping, refresh, сохранение и арена |
| Баффы | Исключающая категория: новое применение заменяет прежнее в той же категории на той же цели | Две способности, один активный бафф; чужие категории сохраняются |
| Ресурсы | Явный kind вместо обязательной зависимости от ID; прежняя эвристика только для старых документов | Roundtrip, custom ID, существующие регрессии переноса между классами |
| Руны | Convert восстанавливающихся рун; substitute resource для typed cost; исходная serial pair сохраняется, после расхода преобразованная руна возвращается к исходному типу; haste retime | Числовой lifecycle 10/20/30, reset, настоящая арена с blood/death |
| Проки | Оружейный PPM, chance в журнале; consecutive reset после фильтров; существующие ICD/charges/chain limits | Вероятность 0.2 при PPM6/speed2; arena PPM60 гарантированного fixture; независимые school events |
| Конструктор | all/any/not; состояние, HP, ресурс, aura stacks, оружие, ранг таланта, предыдущее событие с окном; ability modifier и proc | JS/Python parity, редактор → сервер → reload → сохранённый build → урон 128 |
| Искусность | `% за mastery point` у выбранного ability modifier, с условиями | 9 points, 10 + 2×9 = 28%, 100 → 128; условие по ресурсу выключает бонус |
| Статус талантов | Описание без исполняемых правил явно обозначено; связанные способности проверяются отдельно | Tooltip и Character Lab не считают текст боевой реализацией |
| Стенд защиты | Настраиваемый cast манекена, ручной запуск, прерывание, школьный lockout, cast bar | Настоящие GLB; прерывание до завершения, HP не уменьшается |
| Геометрия | Настоящий манекен смотрит по +X; front/behind из положения при контакте | Четыре наблюдённые проекции; обход WASD и экспорт `behind` |
| Журнал | Attack ID/type/table/roll/hand/side, modifiers/mastery arithmetic, PPM chance, источник версии | Export JSON и details; detached report не может менять live state |
| Изоляция | Рекурсивное копирование/remap вложенных условий и зависимостей; remap ресурсных условий | Два мага 500/150, стандарт 150, копия 700, личный шаблон 500, два build и restart |

Все новые поля optional. Настройки проходят существующие серверные API; второй combat engine не создавался. Платёж и итоговый damage/healing вычисляет runtime, HUD/FX используют события. Точные границы проекта и пользовательские данные сохранены.

## Настройка через интерфейс

1. **Библиотека способностей → Редактировать → Дополнительные настройки → Механика применения**: таблица атаки, школа, рука, нормализация, поведение автоатаки, оплата канала и заменяющие руны. В группе зарядов — имя и длительность общей перезарядки.
2. В **Боевых эффектах** периодической способности — сохранить/перезапустить ближайший тик. У ауры — исключающая категория. Для преобразования рун выберите исходный и новый ресурс; оба должны иметь Rune pair в Character Lab. Конвертация затрагивает уже потраченные восстанавливающиеся руны. Создайте отдельную шкалу Death с начальным 0 и нужной ёмкостью, затем выберите её как substitute у нужной способности.
3. **Персонаж и экипировка → Abilities / Talents**: бонус с модификатором Damage/Healing и другими ability modifiers; поле `% per mastery point`, условия и их группы. В триггере доступны PPM и фильтр Autoattack. Пример: 179.28 mastery rating на 85, bonus 10%, scale 2, 100 base damage → 128. Величина рейтинга остаётся provisional, а сам расчёт проверяется независимо.
4. На странице **Character** включите управляемый входящий урон и задайте Dummy cast seconds. В арене кнопка **Start dummy cast** включает подготовку. Примените свою способность interrupt; проверьте исчезновение cast bar и событие прерывания без входящего урона.
5. Сохраните билд, сохраните проект в аккаунте, перезагрузите приложение, загрузите билд и войдите в тренировку. Все атаки героя запускаются пользователем. Для обычных ударов отдельно включите/выключите автоатаку.
6. **Combat analysis → Timeline → Inspect / Export JSON** показывает исход, таблицу, фактическую сторону, модификаторы и суммы. Отключение обычного debug не меняет механику.

## Реальные модели и синтетические тесты

Браузерные тесты используют четыре исходных GLB из ignored `local-assets/wow`, проверенные по Git LFS SHA256. Hero: 105441844 bytes, dummy: 802176, sword: 18696, guildhouse: 2035904. Три PNG героя также совпадают с LFS. Репозиторий ассетов не изменялся. Модели и извлечённые текстуры не включаются в Git/patch.

`browser_mechanics_integration.py` использует настоящую сцену/WebGL2, но специально созданные тестовые способности и характеристики. Его manifest override меняет только положение героя/манекена в пределах прежнего помещения. Это не официальные class builds. `dummy-inspection.js` показывает четыре диагностических вида одного GLB вне игрового процесса; в игре дополнительные манекены не создаются.

Node-тесты spatial deadlines используют синтетическую сферу/координаты для проверки времени. Они не выдаются за визуальную проверку настоящей геометрии. Браузерные снимки проверены отдельно. Проверки выполнены в Linux Chromium/SwiftShader, не в Windows 11 или на аппаратном GPU.

## Источники и ограничения точности

Полный реестр: [cataclysm-rule-sources.md](cataclysm-rule-sources.md). Текущий аудит исходного состояния: [mechanics-integration-audit.md](mechanics-integration-audit.md).

Armor K, AP weapon contribution, нормализованные скорости, таблицы miss и правила white/yellow сверены с pinned historical SimulationCraft и Firelands 4.3.4. Это вторичные реализации, не прямая проверка поведения Blizzard. Историческая таблица build15354 не импортируется как build15595.

**Не завершено и не объявляется точным оригинальным WoW:**

- Полные DBC build15595: базовые классовые HP/Mana/AP/SP, crit per attribute, рейтинги всех уровней, коэффициенты форм и defensive diminishing returns. Таблиц в среде нет; существующие приближения сохраняются и помечены.
- Полные binary/partial resists, spell-specific исключения и все допустимые critical/block комбинации. Источники противоречат; детерминированная resistance mitigation остаётся приближением. Armor penetration — авторская настройка, не официальный stat 4.3.4.
- Все 30 официальных mastery/spec implementations и точность полного официального каталога. Настраиваемая искусность работает; названия/описания талантов не гарантируют реализацию всех их эффектов.
- Нет автоматического извлечения spell-specific refresh/snapshot/haste/payment исключений из клиента. Они настраиваются автором. Без явного PPM обычные chance/ICD продолжают работать; RPPM и spell-based PPM не добавлены.
- Существующие regen/decay остаются авторскими шкалами с секундным tick, а не точной копией всех внутриклассовых правил regeneration. Rune conversion — явная авторская механика с сохранением pair identity, не полный каталог Death Knight talents.
- Детерминированность проверена для одинакового seed, позиций и расписания команд: редкие/частые advance. Произвольные пользовательские движения/изменение геометрии между кадрами не являются записанным детерминированным replay. Визуальная интерполяция зависит от render FPS, результат урона — от Combat Clock.
- Визуально герой держит один предоставленный меч; отдельной модели оружия второй руки нет. Её таймер, урон и ресурсы проверяются через журнал.
- Новые talent-rank/event-reference условия требуют существующей ссылки. Перед удалением такой исходной записи нужно убрать/изменить соответствующее условие; сервер не сохраняет повреждённый документ.
- Механики с pets, summon, союзниками/другими целями выходят за постоянную границу проекта.

## Воспроизведение проверок

```bash
npm ci
npm test
python -m unittest discover -s tests
npm run build
# После установки Playwright/Chromium и локальных приватных моделей:
python tests/browser_mechanics_integration.py /tmp/tf-mechanics-e2e
python tests/browser_task17_mechanics.py /tmp/tf-task17-regression
python tests/browser_ability_isolation.py /tmp/tf-isolation
python tests/real_guildhouse_browser.py /tmp/tf-scene
python tests/browser_dummy_orientation.py /tmp/tf-dummy-axes.png
```

Каждый браузерный тест создаёт собственную временную SQLite. Постоянные аккаунты и пользовательские проекты не используются и не очищаются. `npm run build` генерирует ignored bundle из исходных модулей. Для локального запуска нужны прежний сервер и `TALENT_LOCAL_WOW_ASSETS=1`; GLB и PNG остаются только в ignored локальном каталоге.

## Выполненные проверки (2026-11-21)

- **317 Node.js tests passed**, 0 fail. Исходный baseline был 288. Новые числовые и сценарные проверки находятся в `cataclysm-reference.test.js`, `combat-clock-reference.test.js`, `mechanic-constructor.test.js`.
- **92 Python unittest passed**, исходный baseline 88. В новых тестах проверяется совпадение принятия/отклонения конфигураций клиентом Node и сервером Python, включая некорректные условия, PPM, категории, rune references.
- `npm run build` — PASS; `git diff --check` — PASS.
- `browser_task17_mechanics.py` — PASS с настоящими GLB: очередь/pushback, один расход, бесплатный cast через ауру, финишер, серийные руны, четыре полосы аур, щиты, reflection, bleed/cap, haste DoT, цепочка проков, критические события, state modifier, knockback, grip, persistence HUD.
- `browser_mechanics_integration.py` — PASS с настоящими GLB/WebGL2: редактор/сервер/reload/build, mastery 128, группа cooldown, dummy cast/interrupt, категория баффа, clipping, отмена оплаченного channel, rune conversion/substitution, main/off hand, PPM и экспорт. После обхода WASD проверен `position: behind`; до обхода — `front`. В отчёте хранится версия правил и честная пометка отсутствующих клиентских таблиц.
- `browser_ability_isolation.py` — PASS: два мага 500/150, стандарт 150, duplicate 700, personal template 500, node movement, два build и перезапуск браузера/сервера. Преднамеренные 404 manifest в этом тесте относятся к запуску без разрешённого маршрута приватных ассетов; это тест изоляции данных, не доказательство загрузки моделей.
- `real_guildhouse_browser.py` — PASS: настоящие materials/textures/bounds (environment24, hero5, weapon1, target1), idle/grip/channel snapshots, manual ranged и two-handed clip, Walk/Run/Jump/Fall, wall/table/corner/passage/camera collision.
- Наблюдены снимки четырёх осей манекена (+X — лицевая сторона), настоящий grip и снимок атаки со спины. Кадры разных анимаций дополнительно проверяются численно через snapshot и grip error; это не просмотр непрерывного видео всех переходов.
- Семь GLB/PNG по размеру и SHA256 совпали с `git lfs ls-files --long` приватного репозитория. Обе исходные рабочие копии чистые, прежние HEAD сохранены; приватный репозиторий чистый.

Артефакты исполнения находятся вне Git: `/workspace/shared/mechanics-integration/`. В них есть `asset-verification.json`, `end-to-end/combat-report.json`, `end-to-end/behind-report.json`, настроенный тестовый документ и снимки. Это тестовые данные, а не база пользователя.
