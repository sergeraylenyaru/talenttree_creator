# Источники и степень подтверждения

Основной профиль — оригинальный 4.3.4, клиент 15595. Клиентских DBC 15595 в этой среде нет. Ни одна реализация эмулятора не принимается как безусловное доказательство поведения Blizzard.

| ID | Источник | Версия / pin | Применение и предел уверенности |
|---|---|---|---|
| FL434 | https://github.com/FirelandsProject/firelands-cata | b250899d4fdf68603e4d8a4d05b4b522d8319eb0, README 4.3.4, DBC loader 15595 | Unit.cpp, StatSystem.cpp — вторичная реализация, сверка формул и порядка событий |
| SC-CATA | https://github.com/simulationcraft/simc/tree/cataclysm-final | 30ad19213524d298fce2e11b34461de7d231046e, 2012-08-29 | Исторический симулятор оригинального Cataclysm, не Cataclysm Classic. Содержит допущения/FIXME |
| SC-DATA | engine/sc_scale_data.inc в SC-CATA | Header явно указывает build 15354 | Сравнение констант, не подтверждённая таблица build 15595. Не импортируется автоматически как 4.3.4 |

## Применяемые формулы

- Armor K — `400+85L` до 60, `467.5L−22167.5` на 60–80, `2167.5L−158167.5` на 81–85. Сверены SC-CATA sc_player.cpp init_attack и FL434 Unit.cpp GetArmorReduction. Cap reduction 75%. Эти независимые реализации согласуются; прямая проверка клиента не выполнена.
- Weapon AP contribution — `AP/14 × базовая скорость`, для normalized weapon damage — отдельная нормализованная скорость. SC-CATA sc_action.cpp calculate_weapon_damage; FL434 StatSystem.cpp CalculateMinMaxDamage и Unit.cpp GetAPMultiplier. Нормализация dagger 1.7, one hand 2.4, two hand 3.3, ranged 2.8. Offhand weapon component 0.5 без отдельных талантов.
- Miss PvE melee — 5/5.5/6/8% на разнице уровней 0/1/2/3. Spell — 4/5/6/17%. SC-CATA sc_attack.cpp miss_chance, sc_spell.cpp miss_chance, FL434 Unit.cpp MeleeSpellHitResult. Для разницы выше трёх исторический источник сам помечает экстраполяцию; UI/журнал не объявляют её точными данными клиента.
- Dual-wield white miss penalty +19 процентных пунктов. Не относится к special и ranged. SC-CATA sc_player.cpp hit cap и классовые auto-attack definitions.
- White melee — одна ordered table miss/dodge/parry/glancing/block/critical/hit. Special — проверка попадания, затем крит успешного результата. SC-CATA sc_attack.cpp build_table/calculate_result и FL434 Unit.cpp RollMeleeOutcomeAgainst.
- Glancing только обычные melee-удары по NPC подходящего уровня, шанс 6/12/18/24% на delta 0/1/2/3. Для boss +3 в данной реализации используется средний множитель 0.75, а не распределение каждого удара. Это обозначенное приближение. Ни special, ни ranged не получают glancing.
- Геометрическая задняя полусфера исключает parry/block для манекена, NPC-dodge может оставаться. FL434 Unit.cpp RollMeleeOutcomeAgainst/MeleeSpellHitResult. У player-цели другие правила; PvP исключено проектом.

## Пока не подтверждено данными 15595

Полные рейтинги/базовые статы/crit-per-attribute по классам и уровням, коэффициенты форм, diminishing returns защиты и все исключения отдельных spells. Текущие авторские коэффициенты Task 17 сохраняют пометку simulation approximation. Исторические данные build 15354 не маскируются под 15595.

Противоречащие реализации (например, отдельные сочетания critical/block и нюансы ranged block) требуют проверки. Выбранная модель special в этом этапе следует SC-CATA. Стандартная ranged table не использует dodge/parry/block; исключения требуют явной настройки конкретного эффекта, а не переноса современного правила.

## Дополнительные решения этого этапа

- Stamina на 85: первые 20 дают по 1 HP, последующие — по 14. SC-CATA `sc_player.cpp:init_resources`, `health_per_stamina` / первые 20 точек. Это исправляет прежние 10 HP на 85; таблицы промежуточных уровней не импортированы. Их fallback 10 остаётся приближением. AP/SP и базовые классовые HP/Mana всё ещё не полный набор клиентских таблиц.
- Mastery: SC-CATA `base_mastery = 8.0`, `init_attack` / инициализация рейтинга. Добавлены 8 базовых очков с 80-го уровня и рейтинг. Конкретное поведение задаёт пользователь через `masteryScale`; это не импорт 30 официальных специализаций. Unlock и коэффициенты конкретных специализаций требуют клиентских данных.
- Обычный оружейный PPM: SC-CATA `sc_action.cpp:ppm_proc_chance`, `weapon_t::proc_chance_on_swing`. Используется `min(1, PPM × base_speed / 60)`. В конструкторе такой PPM ограничен фильтром auto; универсальный PPM для spell/cast/tick и современный RPPM сюда не перенесены.
- Refresh, исключающая категория, rune conversion, пауза/сброс swing timer, cooldown groups, mastery scale — явные авторские настройки. Они моделируют выбранную механику; не объявлены универсальными правилами всех spells оригинального клиента.
- Округление в профиле Cata данного симулятора: после outcome reduction / стаков, затем авторский конечный cap и поглощение. Числовой тест `50.6 × 0.7 → 35`, с cap 30 → 30. Точный внутренний порядок integer truncation Blizzard для всех spell exceptions не подтверждён.
- Сопротивления требуют отдельной верификации. FL434 `CalculateAverageResistReduction` всё ещё содержит boss-level 83 / constant 510; SC-CATA `action_t::resistance` использует иной half-resistance и отключённый участок partial resists. Эти противоречия **не** скрыты импортом формулы из одного источника. Старый deterministic resistance reduction сохранён как приближение; полной binary/partial-resist модели нет.
- Боевая сторона реального `Training-dummy.glb` проверена отдельно: ширина модели вдоль Z, лицо видно со стороны +X. Снимок четырёх проекций и узлы GLB подтверждают ориентацию экспорта. В игре учитывается `π/2 − visual_yaw`, затем относительное положение героя. Fallback-манекен остаётся ориентированным по +Z. Геометрия GLB не изменялась.
