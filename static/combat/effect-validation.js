// Optional declarative combat schema; limits must match server.py.
const common = ['id', 'type', 'trigger'];
const amounts = ['baseAmount', 'scalingStat', 'coefficient', 'canCrit'];
const bonuses = ['flatBonus', 'multiplier', 'critMultiplier', 'attackCoefficient', 'spellCoefficient'];
const timing = ['duration', 'interval', 'stacks', 'refresh', 'snapshot'];
export const combatSchools = ['physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy'];
export const statusStats = ['attackPower', 'spellPower', 'critChance', 'movementSpeed', 'armor', 'damageTaken', 'healingTaken','haste','healthRegen','resourceRegen','maxHealth','maxResource','physicalTaken','magicalTaken','healingPower','healingDone','damageDone'];

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
      fields = [...amounts, ...bonuses, ...timing, ...(e.type === 'damage' ? ['school','minAmount','maxAmount','weaponCoefficient'] : [])];
      if (e.type === 'damage') {
        const minimum = Object.hasOwn(e,'minAmount') ? e.minAmount : e.baseAmount;
        const maximum = Object.hasOwn(e,'maxAmount') ? e.maxAmount : e.baseAmount;
        if (!combatSchools.includes(e.school) || !bounded(minimum,0,1e9) || !bounded(maximum,minimum,1e9)) invalid();
      }
      if (!['none', 'spellPower', 'attackPower','healingPower'].includes(e.scalingStat) || !bounded(e.baseAmount, 0, 1e9) ||
          !bounded(e.coefficient, 0, 1000) || typeof e.canCrit !== 'boolean') invalid();
      for (const key of bonuses) if (Object.hasOwn(e, key) && !bounded(e[key], 0, key === 'flatBonus' ? 1e9 : 1000)) invalid();
      if (e.weaponCoefficient!==undefined&&!bounded(e.weaponCoefficient,0,1000))invalid();
      if (e.snapshot!==undefined&&(typeof e.snapshot!=='boolean'||!e.interval))invalid();
      if (Object.hasOwn(e, 'duration') !== Object.hasOwn(e, 'interval') ||
          Object.hasOwn(e, 'interval') && !bounded(e.interval, .25, e.duration)) invalid();
    } else if (e.type === 'status') {
      fields = ['target', 'name', 'description','icon', 'stat', 'amount', 'duration', 'stacks', 'refresh','school','consumeOnHit'];
      if (!['player', 'dummy'].includes(e.target) || !statusStats.includes(e.stat) ||
          !bounded(e.amount, -100, 500) || !bounded(e.duration, .25, 300) ||
          typeof e.name !== 'string' || !e.name.trim() || e.name.length > 100) invalid();
      if (Object.hasOwn(e, 'icon') && (typeof e.icon !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(e.icon))) invalid();
      if(e.description!==undefined&&(typeof e.description!=='string'||e.description.length>3000))invalid();
      if(e.school!==undefined&&(e.stat!=='damageDone'||!combatSchools.includes(e.school)))invalid();
      if(e.consumeOnHit!==undefined&&(e.stat!=='damageDone'||typeof e.consumeOnHit!=='boolean'))invalid();
      if (e.target === 'dummy' && !['armor','damageTaken','physicalTaken','magicalTaken'].includes(e.stat)) invalid();
      if (e.target === 'player' && ['physicalTaken','magicalTaken'].includes(e.stat)) invalid();
    } else if (e.type === 'shield') {
      fields=['name','description','icon','amount','fraction','coefficient','priority','duration','stacks','refresh'];
      if(typeof e.name!=='string'||!e.name.trim()||e.name.length>100||
        e.description!==undefined&&(typeof e.description!=='string'||e.description.length>3000)||
        e.icon!==undefined&&(typeof e.icon!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(e.icon))||
        !bounded(e.amount,0,1e9)||!bounded(e.fraction,.01,1)||!bounded(e.coefficient,0,1000)||
        !Number.isInteger(e.priority)||!bounded(e.priority,0,100)||!bounded(e.duration,.25,300))invalid();
    } else if (e.type === 'resource') {
      fields = ['resourceId', 'unit', 'amount', 'direction'];
      if (typeof e.resourceId !== 'string' || !e.resourceId || e.resourceId === 'health' || e.resourceId.length > 100 ||
          !['points', 'percent', 'count'].includes(e.unit) || !bounded(e.amount, 0, 1e9) ||
          e.direction!==undefined&&!['gain','drain'].includes(e.direction)) invalid();
    } else invalid();
    if (Object.hasOwn(e, 'duration') && !bounded(e.duration, .25, 300)) invalid();
    if (Object.hasOwn(e, 'stacks') && (!Number.isInteger(e.stacks) || !bounded(e.stacks, 1, 10))) invalid();
    if (Object.hasOwn(e, 'refresh') && !['refresh','refreshOnly','keep','replace','extend','independent'].includes(e.refresh)) invalid();
    if (Object.keys(e).some(k => !common.includes(k) && !fields.includes(k))) invalid();
  }
}
