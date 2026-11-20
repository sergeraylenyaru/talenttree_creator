# Тренировочная площадка

Открой класс в Talent Forge или создай свой в редакторе. Добавь активной способности боевые эффекты в её редакторе. Если способность изучается талантом, вложи очки в него в калькуляторе. Нажми **Тренировочная площадка** рядом с переключателем редактора и калькулятора. Панель использует текущий класс, его основную ветку и распределение очков. Нажимай кнопки способностей или клавиши **1–9**.

В настройках площадки доступны сила заклинаний и атаки, шанс и множитель крита, множители урона по школам, исходящее и входящее лечение игрока, максимум здоровья и защита манекена, множитель получаемого им урона и общая перезарядка от 0 до 3 секунд (по умолчанию 1,5). Применение настроек начинает новый бой. При возврате к дереву выбранные таланты сохраняются. В браузере запоминаются только настройки площадки.

## Правила боя

- При запуске способность должна быть открытой и активной. Проверяются её перезарядка, общая перезарядка, отсутствие другого применения и доступность **всех** ресурсов.
- Стоимость в процентах берётся от максимума соответствующего ресурса, в очках или штуках — из указанного количества. Здоровье после оплаты должно оставаться не ниже 1. Здоровье начинается с максимума, прочие ресурсы — с начальных значений класса. Сброс боя восстанавливает их.
- Мгновенная способность завершается сразу. Во время применения с задержкой можно отменить его. Успешное завершение списывает ресурсы и запускает обе перезарядки. Отмена не расходует ресурсы и не запускает перезарядки. Поддерживаемая способность срабатывает один раз в конце.
- Сначала исполняются эффекты `onCast`, затем после гарантированного попадания — `onHit`. Внутри каждой группы используется порядок из документа. Каждый эффект с разрешённым критом получает независимый бросок. Урон применяется к манекену, лечение — к игроку.
- Урон ограничен оставшимся здоровьем манекена. После его поражения способности с уроном блокируются до сброса. Лечение сверх максимального здоровья записывается как избыточное.
- Пауза останавливает боевое время, включая применение и перезарядки. Журнал показывает недавние события от новых к старым. Его можно очистить отдельно от показателей. DPS делит фактически нанесённый урон на боевое время с первого события, нанёсшего урон. При нулевом интервале DPS равен нулю. Доля критов считается по всем рассчитанным эффектам.

Манекен не атакует. Регенерация, периодические эффекты, экипировка и боевые модификаторы талантов за пределами MVP. Открытые пассивные способности отображаются для справки.

## Устройство

`build-compiler.js` проверяет копию документа и выбранный билд, применяет правила открытия способностей и разрешает затраты ресурсов. `combat-state.js` хранит здоровье, ресурсы и показатели и выполняет чистые переходы состояния. `combat-runtime.js` планирует применения, списывает затраты и отправляет эффекты независимому [расчётному движку](combat-calculation.md). Его часы можно продвигать явно. Экран площадки продвигает их по монотонному времени браузера и обновляет интерфейс через `requestAnimationFrame`. Площадка не меняет документ класса и не отправляет боевые события на сервер.

### 3D weapon swings

Right-click the training dummy to select it and start autoattack. Use the Autoattack
button or the assigned Basic Attack slot to stop it. Right-drag orbits the camera,
left-click selects a target, and the wheel zooms. S backpedals at walking speed.

The training sword uses a two-second swing interval and 55 base physical damage
before the normal armor and critical-hit calculations. Set optional numeric
`swingSeconds` and `damage` on `weapons.mainHand` in the ignored local asset
manifest to tune these values. The first hit lands as soon as range and line of sight allow it. Subsequent hits
respect the swing interval, including after moving briefly out of range. It runs independently of ability costs and cooldowns.

Damage meter DPS uses the interval from the start of the first action that landed
damage to the most recent damaging impact. Idle time after the final hit leaves
the result stable. Clearing the separate combat log keeps the meter totals.

In 3D, resolved damage appears above the dummy with the ability icon. Physical
damage is white, magical damage is yellow, and effective healing is green above
the player. The 3D range check measures to the target volume.

### Spell Workshop

Open **Spell Library** in class edit mode to create, find, duplicate, rename,
import, or export an ability. The workshop edits the same ability that a talent
unlocks and the arena executes. Use **Ability templates** for starters and
**Save as template** for reusable local presets.

In **Combat presentation**, choose delivery, targeting, an impact and optional
local hero clips. **Advanced settings** includes charge recharge, GCD, cast
interruption, projectile parameters, timing, visual modifiers and procedural
sounds. Periodic damage or healing takes its first tick after the configured
interval. A ground-targeted periodic damage effect creates a world zone that
checks the dummy's position and line of sight on each tick. The training arena
has one hostile target. Self-targeted effects apply to the player.

**Preview in 3D** opens a separate session using unsaved editor settings. The
preview supplies health missing from the player if the ability heals. Close it
to return to the draft. **Save and open Training Grounds** opens normal combat
with the saved class, current talent build and actual costs.

Open **Assign slots** to drag a spell to either action row or use its slot
selector. Select the empty option to clear a slot. The first row uses **1–9**
and the second uses **Shift+1–9**. Locked or temporarily disabled abilities keep
their slot references while they are unavailable.
