import {validateCombatEffects} from './effect-validation.js';

const schools = ['physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy'];
const defaultRules = Object.freeze({armorConstant:4000, resistanceConstant:4000, maxDamageReduction:0.75});

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError(`${label} must be a plain object`);
  }
  return value;
}
function keys(value, allowed, label) {
  record(value, label);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(`Unknown ${label} field`);
}
function number(value, label, min=0, max=Number.MAX_VALUE) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}
// Only absent properties receive defaults; null and explicit undefined are invalid.
function read(object, key, fallback) {
  return Object.hasOwn(object, key) ? object[key] : fallback;
}
function schoolMap(value, label, fallback) {
  keys(value, schools, label);
  return Object.fromEntries(schools.map(school => [school, number(read(value, school, fallback), `${label}.${school}`)]));
}
function rulesContext(value) {
  keys(value, Object.keys(defaultRules), 'rules');
  const rules = {};
  for (const key of ['armorConstant', 'resistanceConstant']) {
    rules[key] = number(read(value, key, defaultRules[key]), key);
    if (rules[key] === 0) throw new RangeError(`${key} must be positive`);
  }
  rules.maxDamageReduction = number(read(value, 'maxDamageReduction', 0.75), 'maxDamageReduction', 0, 1);
  return rules;
}
function targetContext(value) {
  keys(value, ['armor', 'resistances', 'damageTakenMultiplier', 'healingTakenMultiplier'], 'target');
  return {
    armor:number(read(value, 'armor', 0), 'armor'),
    resistances:schoolMap(read(value, 'resistances', {}), 'resistances', 0),
    damageTakenMultiplier:number(read(value, 'damageTakenMultiplier', 1), 'damageTakenMultiplier'),
    healingTakenMultiplier:number(read(value, 'healingTakenMultiplier', 1), 'healingTakenMultiplier')
  };
}
function calculationContext(value) {
  keys(value, ['source', 'target', 'rules', 'outcome'], 'context');
  const source = read(value, 'source', {});
  keys(source, ['spellPower', 'attackPower','healingPower','weaponDamage','flatDamage', 'critChance', 'critMultiplier', 'damageMultiplier', 'healingMultiplier', 'schoolDamageMultipliers'], 'source');
  const normalized = {};
  for (const key of ['spellPower', 'attackPower','healingPower','weaponDamage','flatDamage', 'critChance']) {
    normalized[key] = number(read(source, key, 0), key, 0, key==='critChance' ? 1 : Number.MAX_VALUE);
  }
  for (const key of ['critMultiplier', 'damageMultiplier', 'healingMultiplier']) {
    normalized[key] = number(read(source, key, 1), key);
  }
  normalized.schoolDamageMultipliers = schoolMap(read(source, 'schoolDamageMultipliers', {}), 'schoolDamageMultipliers', 1);
  const outcome = read(value, 'outcome', {});
  keys(outcome, ['isCritical','amountRoll'], 'outcome');
  const isCritical = read(outcome, 'isCritical', false);
  if (typeof isCritical !== 'boolean') throw new TypeError('isCritical must be boolean');
  const amountRoll = number(read(outcome,'amountRoll',0),'amount roll',0,1);
  return {source:normalized, target:targetContext(read(value, 'target', {})), rules:rulesContext(read(value, 'rules', {})), outcome:{isCritical,amountRoll}};
}
function mitigation(school, target, rules) {
  if (!schools.includes(school)) throw new TypeError('Unsupported damage school');
  const physical = school === 'physical';
  const defense = physical ? target.armor : target.resistances[school];
  const constant = physical ? rules.armorConstant : rules.resistanceConstant;
  // Algebraically equivalent to defense/(defense+constant), without overflowing the sum.
  const uncappedReduction = defense===0 ? 0 : defense>constant
    ? 1/(1+constant/defense) : (defense/constant)/(1+defense/constant);
  const reduction = Math.min(uncappedReduction, rules.maxDamageReduction);
  return {kind:physical?'armor':'resistance', defense, constant, uncappedReduction, reduction, multiplier:1-reduction};
}

/** Deterministic roll: the caller supplies randomness; chance is never rolled by calculations. */
export function rollCritical(chance, randomValue) {
  number(chance, 'chance', 0, 1);
  number(randomValue, 'randomValue', 0, 1);
  if (randomValue === 1) throw new RangeError('randomValue must be less than 1');
  return randomValue < chance;
}

/** Returns mitigation details; accepts partial target/rules without mutating them. */
export function calculateMitigation(school, target={}, rules={}) {
  return mitigation(school, targetContext(target), rulesContext(rules));
}
function calculate(effect, context, expectedType) {
  record(effect, 'effect');
  validateCombatEffects({combatEffects:[effect]});
  if (!['damage','healing'].includes(effect.type) || expectedType && effect.type !== expectedType) throw new TypeError(`Expected ${expectedType} effect`);
  const {source, target, rules, outcome} = calculationContext(context);
  const damage = effect.type === 'damage';
  const scalingAmount = number((effect.scalingStat==='none' ? 0 : source[effect.scalingStat])*effect.coefficient +
    source.attackPower*(effect.attackCoefficient ?? 0) + source.spellPower*(effect.spellCoefficient ?? 0), 'scalingAmount');
  const minimum = effect.minAmount ?? effect.baseAmount;
  const maximum = effect.maxAmount ?? effect.baseAmount;
  const rolledAmount = minimum + (maximum - minimum) * outcome.amountRoll;
  const rawAmount = number(rolledAmount+scalingAmount+(effect.flatBonus ?? 0)+
    (damage ? source.flatDamage + source.weaponDamage*(effect.weaponCoefficient??0) : 0), 'rawAmount');
  const isCritical = effect.canCrit && outcome.isCritical;
  const multipliers = {
    source:(damage ? source.damageMultiplier : source.healingMultiplier)*(effect.multiplier ?? 1),
    school:damage ? source.schoolDamageMultipliers[effect.school] : 1,
    target:damage ? target.damageTakenMultiplier : target.healingTakenMultiplier,
    critical:isCritical ? effect.critMultiplier ?? source.critMultiplier : 1
  };
  const modifiedAmount = number(number(number(rawAmount*multipliers.source, 'source modified amount')*multipliers.school, 'school modified amount')*multipliers.target, 'modifiedAmount');
  const criticalAmount = number(modifiedAmount*multipliers.critical, 'criticalAmount');
  multipliers.total = number(number(number(multipliers.source*multipliers.school, 'combined source multiplier')*multipliers.target, 'combined target multiplier')*multipliers.critical, 'total multiplier');
  const reduction = damage ? mitigation(effect.school, target, rules) :
    {kind:'none', defense:0, constant:null, uncappedReduction:0, reduction:0, multiplier:1};
  const unroundedAmount = number(criticalAmount*reduction.multiplier, 'unroundedAmount');
  const finalAmount = Math.round(unroundedAmount);
  if (!Number.isSafeInteger(finalAmount)) throw new RangeError('finalAmount exceeds safe integer precision');
  return {
    effectId:effect.id, type:effect.type, ...(damage ? {school:effect.school} : {}),
    baseAmount:effect.baseAmount, scalingAmount, rawAmount, multipliers,
    modifiedAmount, isCritical, criticalAmount,
    mitigation:{...reduction, preventedAmount:criticalAmount-unroundedAmount},
    unroundedAmount, finalAmount
  };
}

export function calculateDamage(effect, context={}) { return calculate(effect, context, 'damage'); }
export function calculateHealing(effect, context={}) { return calculate(effect, context, 'healing'); }
export function calculateCombatEffect(effect, context={}) { return calculate(effect, context); }
