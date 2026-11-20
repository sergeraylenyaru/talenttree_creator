// Optional declarative combat schema; limits must match server.py.
const common = ['id', 'type', 'trigger'];
const amounts = ['baseAmount', 'scalingStat', 'coefficient', 'canCrit'];
const bonuses = ['flatBonus', 'multiplier', 'critMultiplier', 'attackCoefficient', 'spellCoefficient'];
const timing = ['duration', 'interval', 'stacks', 'refresh'];
export const combatSchools = ['physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy'];
export const statusStats = ['attackPower', 'spellPower', 'critChance', 'movementSpeed', 'armor', 'damageTaken', 'healingTaken'];

export function validateCombatEffects(ability) {
  if (!Object.hasOwn(ability, 'combatEffects')) return;
  const effects = ability.combatEffects;
  const ids = new Set();
  const invalid = () => { throw Error('Проверь боевые эффекты'); };
  const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  if (!Array.isArray(effects) || effects.length > 32) invalid();
  for (const e of effects) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) invalid();
    if (typeof e.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(e.id) || ids.has(e.id)) invalid();
    ids.add(e.id);
    if (!['onCast', 'onHit'].includes(e.trigger)) invalid();
    let fields;
    if (['damage', 'healing'].includes(e.type)) {
      fields = [...amounts, ...bonuses, ...timing, ...(e.type === 'damage' ? ['school','minAmount','maxAmount'] : [])];
      if (e.type === 'damage') {
        const minimum = Object.hasOwn(e,'minAmount') ? e.minAmount : e.baseAmount;
        const maximum = Object.hasOwn(e,'maxAmount') ? e.maxAmount : e.baseAmount;
        if (!combatSchools.includes(e.school) || !bounded(minimum,0,1e9) || !bounded(maximum,minimum,1e9)) invalid();
      }
      if (!['none', 'spellPower', 'attackPower'].includes(e.scalingStat) || !bounded(e.baseAmount, 0, 1e9) ||
          !bounded(e.coefficient, 0, 1000) || typeof e.canCrit !== 'boolean') invalid();
      for (const key of bonuses) if (Object.hasOwn(e, key) && !bounded(e[key], 0, key === 'flatBonus' ? 1e9 : 1000)) invalid();
      if (Object.hasOwn(e, 'duration') !== Object.hasOwn(e, 'interval') ||
          Object.hasOwn(e, 'interval') && !bounded(e.interval, .25, e.duration)) invalid();
    } else if (e.type === 'status') {
      fields = ['target', 'name', 'icon', 'stat', 'amount', 'duration', 'stacks', 'refresh'];
      if (!['player', 'dummy'].includes(e.target) || !statusStats.includes(e.stat) ||
          !bounded(e.amount, -100, 500) || !bounded(e.duration, .25, 300) ||
          typeof e.name !== 'string' || !e.name.trim() || e.name.length > 100) invalid();
      if (Object.hasOwn(e, 'icon') && (typeof e.icon !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(e.icon))) invalid();
      if (e.target === 'dummy' && !['armor', 'damageTaken'].includes(e.stat)) invalid();
      if (e.target === 'player' && ['armor', 'damageTaken'].includes(e.stat)) invalid();
    } else if (e.type === 'resource') {
      fields = ['resourceId', 'unit', 'amount'];
      if (typeof e.resourceId !== 'string' || !e.resourceId || e.resourceId === 'health' || e.resourceId.length > 100 ||
          !['points', 'percent', 'count'].includes(e.unit) || !bounded(e.amount, 0, 1e9)) invalid();
    } else invalid();
    if (Object.hasOwn(e, 'duration') && !bounded(e.duration, .25, 300)) invalid();
    if (Object.hasOwn(e, 'stacks') && (!Number.isInteger(e.stacks) || !bounded(e.stacks, 1, 10))) invalid();
    if (Object.hasOwn(e, 'refresh') && !['refresh', 'keep', 'replace'].includes(e.refresh)) invalid();
    if (Object.keys(e).some(k => !common.includes(k) && !fields.includes(k))) invalid();
  }
}
