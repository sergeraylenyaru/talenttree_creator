import {effectPresets} from './effect-presets.js';

export const animationClips = {
  sword: 'Attack1H (ID 17 variation 0)',
  twoHand: 'Attack2H (ID 18 variation 0)',
  bow: 'AttackBow (ID 46 variation 0)',
  cast: 'SpellCastDirected (ID 53 variation 0)',
  area: 'SpellCastOmni (ID 54 variation 0)',
  channel: 'ChannelCastDirected (ID 124 variation 0)',
  guard: 'ShieldBlock (ID 24 variation 0)',
  movement: 'Jump (ID 38 variation 0)',
  hurt: 'CombatWound (ID 9 variation 0)'
};

export const presentationOptions = {
  category: ['attack', 'spell', 'healing', 'area', 'defense', 'movement', 'physical', 'magical', 'support', 'utility'],
  delivery: ['melee', 'ranged'],
  animation: [...Object.keys(animationClips), 'none'],
  castingAnimation: [...Object.keys(animationClips), 'none'],
  attackAnimation: [...Object.keys(animationClips), 'none'],
  startAnimation: [...Object.keys(animationClips), 'none'],
  finishAnimation: [...Object.keys(animationClips), 'none'],
  impactAnimation: [...Object.keys(animationClips), 'none'],
  projectileOrigin: ['caster','hand','weapon'],
  trajectory: ['linear','arc'],
  impactAnchor: ['contact','target','caster','ground'],
  effectPreset: Object.keys(effectPresets),
  projectilePreset: Object.keys(effectPresets),
  projectile: ['none', 'straight', 'homing'],
  impact: ['none', 'melee', 'fire', 'frost', 'arcane', 'holy', 'nature', 'shadow', 'healing', 'defense'],
  hitReaction: ['normal', 'heavy', 'none'],
  sound: ['strike', 'spark', 'chime'],
  targeting: ['dummy', 'self', 'area', 'targetArea', 'ground']
};

export const presentationLimits = {projectileSpeed: [1, 100], channelDuration: [0, 120], arcHeight: [0, 5]};

export const animationFields = ['animation','castingAnimation','attackAnimation','startAnimation','finishAnimation','impactAnimation'];
export const isLocalClip = value => typeof value === 'string' && value.startsWith('clip:') && value.length > 5 &&
  value.length <= 155 && !/[\x00-\x1f\x7f]/.test(value);

export function validatePresentation(ability) {
  if (!Object.hasOwn(ability, 'presentation')) return;
  const data = ability.presentation;
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.entries(data).some(([key, value]) => {
    if (animationFields.includes(key) && isLocalClip(value)) return false;
    if (Object.hasOwn(presentationOptions, key)) return !presentationOptions[key].includes(value);
    if (!Object.hasOwn(presentationLimits, key)) return true;
    const [min, max] = presentationLimits[key];
    return !Number.isFinite(value) || value < min || value > max;
  })) throw Error('Проверь оформление способности');
}

export const presentationPresets = {
  sword: {category: 'attack', delivery: 'melee', attackAnimation: 'sword', impact: 'melee', sound: 'strike'},
  twoHand: {category: 'attack', delivery: 'melee', attackAnimation: 'twoHand', impact: 'melee', hitReaction: 'heavy', sound: 'strike'},
  bow: {category: 'attack', delivery: 'ranged', attackAnimation: 'bow', projectile: 'straight', projectileSpeed: 20, sound: 'strike'},
  fire: {category: 'spell', delivery: 'ranged', castingAnimation: 'cast', projectile: 'straight', impact: 'fire', sound: 'spark'},
  frost: {category: 'spell', delivery: 'ranged', castingAnimation: 'cast', projectile: 'homing', impact: 'frost', sound: 'spark'},
  healing: {category: 'healing', targeting: 'self', castingAnimation: 'area', animation: 'area', impact: 'healing', sound: 'chime'},
  area: {category: 'area', targeting: 'area', animation: 'area', projectile: 'none', impact: 'arcane'},
  guard: {category: 'defense', targeting: 'self', animation: 'guard', impact: 'defense', sound: 'chime'},
  movement: {category: 'movement', targeting: 'self', animation: 'movement'}
};


export function presentationRange(range, presentation, meleeRange = 2) {
  if (presentation?.delivery === 'melee') return Math.min(range||meleeRange,meleeRange);
  if (range > 0) return range;
  if (presentation?.targeting === 'area') return 8;
  if (presentation?.delivery === 'ranged' || ['straight', 'homing'].includes(presentation?.projectile)) return 30;
  return meleeRange;
}
