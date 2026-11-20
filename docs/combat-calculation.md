# Combat Calculation Engine v1 / Расчёт боевых эффектов v1

## Назначение / Purpose

`static/combat/calculation-engine.js` — независимая библиотека чистых функций ES modules для браузера и Node.js 22+. Она не обращается к DOM, сети, времени или генератору случайных чисел и не изменяет входные объекты. Редактор сохраняет данные как прежде; на [тренировочной площадке](training-grounds.md) эффекты исполняет отдельный боевой модуль.

An independent ES module for browsers and Node.js 22+. Functions have no DOM, UI, runtime package, network, clock or RNG dependencies and do not mutate inputs. The [Training Grounds](training-grounds.md) runtime uses this library to resolve stored effects.

## API

```js
import {
  calculateDamage, calculateHealing, calculateCombatEffect,
  calculateMitigation, rollCritical
} from './static/combat/calculation-engine.js';

const effect = {
  id: 'fireball-hit', type: 'damage', trigger: 'onHit', school: 'fire',
  baseAmount: 120, scalingStat: 'spellPower', coefficient: 0.65, canCrit: true
};
const context = {
  source: {
    spellPower: 200, attackPower: 100, critChance: 0.25, critMultiplier: 2,
    damageMultiplier: 1.1, healingMultiplier: 1,
    schoolDamageMultipliers: {fire: 1.2}
  },
  target: {
    armor: 1000, resistances: {fire: 1000, frost: 0},
    damageTakenMultiplier: 1, healingTakenMultiplier: 1
  },
  rules: {armorConstant: 4000, resistanceConstant: 4000, maxDamageReduction: 0.75},
  outcome: {isCritical: false}
};
calculateDamage(effect, context).finalAmount;       // 264
calculateCombatEffect(effect, context).finalAmount; // 264
calculateMitigation('fire', context.target, context.rules).reduction; // 0.2
rollCritical(0.25, 0.2); // true; 0.2 is supplied by the caller
rollCritical(0.25, 0.25); // false
calculateDamage(effect, {
  ...context, outcome: {isCritical: true}
}).finalAmount; // 528

const heal = {
  id: 'heal', type: 'healing', trigger: 'onCast',
  baseAmount: 80, scalingStat: 'spellPower', coefficient: 0.5, canCrit: true
};
calculateHealing(heal, {
  source: {spellPower: 200, healingMultiplier: 1.5, critMultiplier: 2},
  target: {healingTakenMultiplier: 0.5}, outcome: {isCritical: true}
}).finalAmount; // 270
```

`calculateDamage` принимает только `damage`, `calculateHealing` — только `healing`; `calculateCombatEffect` выбирает расчёт по типу. Все три используют исходную проверку схемы эффектов из `effect-validation.js`, также экспортируемую через `engine.js`. Схема способности и версия документа не меняются. Поле `trigger` проверяется, но библиотека не планирует события и не исполняет способность целиком.

Dedicated damage/healing functions reject the other effect type. The dispatcher accepts either type. All reuse the existing effect validator, also re-exported by `engine.js`. Ability schema and document version are unchanged. Triggers are validated data, not event scheduling instructions. Callers decide which effect to calculate and supply precomputed character/ability modifiers in the context; no classes or talent schemas are hardcoded.

## Формулы / Formulas

```text
scalingAmount = (scalingStat == none ? 0 : source[scalingStat]) * coefficient
rawAmount = rolledBaseAmount + scalingAmount + flatBonus
            + (damage ? flatDamage + weaponDamage * weaponCoefficient : 0)

Damage:
modifiedAmount = rawAmount * damageMultiplier
                 * schoolDamageMultipliers[school] * damageTakenMultiplier
criticalAmount = modifiedAmount * (canCrit && outcome.isCritical ? critMultiplier : 1)
defense = (school == physical ? armor : resistances[school])
constant = (school == physical ? armorConstant : resistanceConstant)
reduction = min(defense / (defense + constant), maxDamageReduction)
unroundedAmount = criticalAmount * (1 - reduction)
finalAmount = Math.round(unroundedAmount)

Healing:
modifiedAmount = rawAmount * healingMultiplier * healingTakenMultiplier
criticalAmount = modifiedAmount * (canCrit && outcome.isCritical ? critMultiplier : 1)
unroundedAmount = criticalAmount
finalAmount = Math.round(unroundedAmount)
```

Все семь школ: `physical`, `fire`, `frost`, `arcane`, `nature`, `shadow`, `holy`. Школьный множитель применяется и к физическому урону. Физический урон использует только броню; магический — только сопротивление своей школе. Для защиты от переполнения суммы знаменателя реализация использует алгебраически равнозначное отношение. Лечение игнорирует броню, сопротивления и множители урона; не ограничивается недостающим здоровьем. Округление выполняется один раз в конце. Это общая настраиваемая формула, не точная модель какой-либо версии WoW.

All seven schools are supported, including a physical school multiplier. Physical damage uses armor only; magic uses its matching resistance only. Mitigation uses an algebraically equivalent ratio to avoid overflowing the denominator sum. Healing ignores armor, resistance and damage modifiers and is not capped to missing health. Rounding occurs only at the end. These configurable formulas are not an exact reproduction of a WoW expansion.

## Значения по умолчанию и проверка / Defaults and validation

| Поле / Field | По умолчанию / Default | Допустимые значения / Accepted values |
|---|---:|---|
| `source.spellPower`, `source.attackPower` | 0 | Конечное число ≥ 0 / Finite number ≥ 0 |
| `source.critChance` | 0 | 0…1 |
| Все множители, включая `critMultiplier` / All multipliers, including `critMultiplier` | 1 | Конечное число ≥ 0 / Finite number ≥ 0 |
| `target.armor`, каждое сопротивление / each resistance | 0 | Конечное число ≥ 0 / Finite number ≥ 0 |
| `rules.armorConstant`, `rules.resistanceConstant` | 4000 | Конечное число > 0 / Finite number > 0 |
| `rules.maxDamageReduction` | 0.75 | 0…1 |
| `outcome.isCritical` | false | Строго boolean / Boolean only |

Объект контекста и его разделы могут отсутствовать. В переданном объекте значения по умолчанию применяются только к отсутствующим полям. `null`, явный `undefined` внутри объекта, строки, boolean вместо чисел, NaN, Infinity, отрицательные числа и неизвестные поля отклоняются. Проверяются также переданные, но не используемые в данном расчёте параметры. В картах школ разрешены только семь известных имён; физическое сопротивление проверяется, но не используется вместо брони. Нулевые множители разрешены. Множитель крита по умолчанию равен 1: для увеличения результата явно передайте, например, 2.

Context and its sections may be omitted. Within provided objects only missing fields receive defaults. Null, explicit undefined fields, strings, booleans as numbers, NaN, Infinity, negative values and unknown fields are rejected. Supplied but unused parameters are still validated. School maps accept only the seven known names; physical resistance is validated but never used in place of armor. Zero multipliers are allowed. The default critical multiplier is neutral (1); explicitly pass e.g. 2 for doubled critical amounts.

Вычисления отклоняют переполнение промежуточных значений и итог вне безопасного целого JavaScript (`Number.MAX_SAFE_INTEGER`). Некорректные эффекты вызывают ошибку исходного валидатора; некорректный контекст/тип — `TypeError` или `RangeError`. Ошибки не скрываются и не заменяются нулём.

Intermediate overflow and rounded results outside JavaScript safe integer precision are rejected. Invalid effects throw the original schema validator error; invalid context/type throws TypeError or RangeError. Invalid inputs are not silently clamped or replaced with zero.

`rollCritical(chance, randomValue)` принимает chance ∈ [0,1] и randomValue ∈ [0,1), возвращает `randomValue < chance`. Расчётные функции никогда не бросают крит самостоятельно: даже chance=1 не заменяет `outcome.isCritical`. При `canCrit=false` критический множитель всегда 1.

`rollCritical` accepts chance in [0,1] and randomValue in [0,1), returning strict `randomValue < chance`. Calculations never roll: even chance=1 does not replace the explicit outcome. Disabled criticals always use a critical multiplier of 1.

## Детализация результата / Breakdown

- `effectId`, `type`, `school` (только урон / damage only): идентичность эффекта / effect identity.
- `baseAmount`, `scalingAmount`, `rawAmount`: исходные части суммы / base, scaling and sum.
- `multipliers.source`, `.school`, `.target`, `.critical`, `.total`: фактически применённые множители и их произведение / applied factors and their product. Для лечения school=1 / healing uses school=1.
- `modifiedAmount`: сумма после множителей источника, школы и цели, до крита / amount after source, school and target multipliers, before critical.
- `isCritical`: `canCrit && outcome.isCritical`.
- `criticalAmount`: сумма после критического множителя / amount after critical factor.
- `mitigation`: `kind` (`armor`, `resistance`, `none`), `defense`, `constant`, `uncappedReduction`, `reduction`, `multiplier`, `preventedAmount` (до округления / before rounding).
- `unroundedAmount`, `finalAmount`: результат до и после округления / amount before and after rounding.

`calculateMitigation` возвращает только базовые поля mitigation, без `preventedAmount`, поскольку величина эффекта ему не передаётся. У лечения kind=`none`, constant=`null`, reduction=0, multiplier=1, preventedAmount=0.

`calculateMitigation` returns the mitigation fields without preventedAmount, since it receives no effect amount. Healing uses kind=none, constant=null, reduction=0, multiplier=1 and preventedAmount=0.

The arena integration, equipment formulas and shield ordering are documented in [Character Lab and combat analysis](rpg-combat.md).
