export const workshopNumbers = {
  groupCooldown:[0,3600,0],finisherScale:[0,100,1], requiredLevel:[1,1000,1], baseLevel:[1,1000,1], levelScale:[0,100,0],
  rank: [1, 100, 1], rankScale: [0, 100, 0], talentRank: [1, 100, 1], minRange: [0, 100, 0],
  charges: [1, 10, 1], recharge: [0.25, 3600, 10], gcdDuration: [0, 3, ''],
  tickInterval: [0.25, 120, ''], radius: [0.25, 30, 5],
  projectileLifetime: [0.25, 30, 5], collisionRadius: [.02, 1, .12],
  projectileSize: [.02, 2, .14], homingStrength: [.1, 30, 8],
  effectSpeed: [.1, 5, 1], effectIntensity: [.1, 2, 1], effectScale: [.1, 4, 1], effectDuration: [.05, 5, .35], opacity: [0, 1, .72],
  playback: [.25, 3, 1], blend: [0, 1, .16], volume: [0, 1, .65],
  variation: [0, .5, 0]
};
export const workshopFlags = ['disabled', 'hidden', 'noGcd', 'interruptMovement', 'uninterruptible', 'facing', 'loopAnimation','consumeFreeAura','normalizedWeapon'];
export const soundNames = ['strike', 'spark', 'chime'];

export function validateWorkshop(ability) {
  if (!Object.hasOwn(ability, 'workshop')) return;
  const rules = ability.workshop;
  const fail = message => { throw new Error(message); };
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) || rules.version !== 1) fail('Неверная версия настроек мастерской');
  for (const [key, value] of Object.entries(rules)) {
    if (key === 'version') continue;
    if (workshopFlags.includes(key) && typeof value === 'boolean') continue;
    if (Object.hasOwn(workshopNumbers, key)) {
      const [min, max] = workshopNumbers[key];
      if (Number.isFinite(value) && value >= min && value <= max &&
          (!['rank', 'talentRank', 'charges'].includes(key) || Number.isInteger(value))) continue;
    }
    if (['activationSound','castSound','launchSound','impactSound','criticalSound','tickSound','buffSound','debuffSound','healSound'].includes(key) && soundNames.includes(value)) continue;
    if (['casterEffect','weaponEffect','projectileEffect'].includes(key) && ['none','melee','fire','frost','arcane','holy','nature','shadow','healing','defense'].includes(value)) continue;
    if (key === 'flightDirection' && ['aim','forward'].includes(value)) continue;
    if (key === 'areaShape' && ['circle','cone'].includes(value)) continue;
    if (key === 'color' && typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value)) continue;
    if(key==='cooldownGroup'&&typeof value==='string'&&value.trim().length>0&&value.length<=60)continue;
    if(key==='channelPayment'&&['start','firstTick'].includes(value))continue;
    if(key==='swingPolicy'&&['continue','pause','reset'].includes(value))continue;
    if(key==='attackType'&&['melee','ranged','spell'].includes(value))continue;
    if(key==='weaponHand'&&['mainHand','offHand','ranged'].includes(value))continue;
    if(key==='attackSchool'&&['physical','fire','frost','arcane','nature','shadow','holy'].includes(value))continue;
    if(key==='requiredClass'&&['warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid','deathknight'].includes(value))continue;
    if(key==='requiredStateKey'&&['form','stance','aspect','seal','mode'].includes(value))continue;
    if(['freeWithAura','finisherResource','runeSubstitute'].includes(key)&&typeof value==='string'&&value.length>0&&value.length<=200)continue;
    if(key==='requiredStateValue'&&typeof value==='string'&&value.length>0&&value.length<=60)continue;
    if (key === 'tier' && typeof value === 'string' && value.length <= 40) continue;
    fail('Проверь настройку способности: ' + key);
  }
  if(rules.groupCooldown!==undefined&&!rules.cooldownGroup)fail('Укажи группу перезарядки');
  const p = ability.presentation ?? {};
  const effects = ability.combatEffects ?? [];
  const channel = p.channelDuration ?? 0;
  if (rules.tickInterval && (rules.tickInterval > channel || p.delivery === 'melee' || ['straight','homing'].includes(p.projectile))) {
    fail('Интервал должен помещаться в длительность канала. Для тиков нужна мгновенная доставка.');
  }
  for (const key of ['cast','cooldown','range']) {
    if (!Number.isFinite(ability[key]) || ability[key] < 0 || ability[key] > 1e9) fail('Проверь время применения, перезарядку и дальность');
  }
  const maxRange = p.delivery === 'melee' ? Math.min(ability.range || 2, 2) : ability.range || (p.targeting === 'area' ? 8 : 30);
  if ((rules.minRange ?? 0) > maxRange) fail('Минимальная дальность превышает максимальную');
  if (p.category === 'healing' && !effects.some(e => e.type === 'healing')) fail('Добавь эффект лечения');
  const hostile = effects.some(isHostileEffect);
  if (p.category === 'attack' && !effects.some(e => e.type === 'damage')) fail('Добавь эффект урона');
  if (hostile && p.targeting === 'self') fail('Урон и ослабления требуют враждебную цель');
  if (p.targeting === 'ground' && (p.delivery === 'melee' || ['straight','homing'].includes(p.projectile))) fail('Для точки на земле выбери мгновенную доставку');
}

export function isHostileEffect(effect) {
  return effect.type === 'damage' || ['status','control'].includes(effect.type) && effect.target === 'dummy';
}
