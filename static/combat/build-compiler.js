import {abilityUnlocked, normalize, total, validBuild} from '../engine.js';
import {abilityResourceCosts, classResources} from '../resource-costs.js';

export const schools = ['physical', 'fire', 'frost', 'arcane', 'nature', 'shadow', 'holy'];
export const statDefaults = {
  spellPower: 0, attackPower: 0, critChance: 0.1, critMultiplier: 2,
  damageMultiplier: 1, healingMultiplier: 1
};

function bounded(value, fallback, max = Number.MAX_SAFE_INTEGER, min = 0) {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function normalizeCombatSettings(input) {
  const source = input?.stats;
  const target = input?.dummy;
  return {
    stats: {
      ...Object.fromEntries(Object.entries(statDefaults).map(([key, fallback]) =>
        [key, bounded(source?.[key], fallback, key === 'critChance' ? 1 : undefined)])),
      schoolDamageMultipliers: Object.fromEntries(schools.map(school =>
        [school, bounded(source?.schoolDamageMultipliers?.[school], 1)]))
    },
    dummy: {
      maxHealth: bounded(target?.maxHealth, 1_000_000, Number.MAX_SAFE_INTEGER, 1),
      armor: bounded(target?.armor, 0),
      resistances: Object.fromEntries(schools.slice(1).map(school =>
        [school, bounded(target?.resistances?.[school], 0)])),
      damageTakenMultiplier: bounded(target?.damageTakenMultiplier, 1),
      healingTakenMultiplier: bounded(target?.healingTakenMultiplier, 1)
    },
    healingTakenMultiplier: bounded(input?.healingTakenMultiplier, 1),
    globalCooldown: bounded(input?.globalCooldown, 1.5, 3)
  };
}

function duration(value) {
  return bounded(typeof value === 'string' ? Number.parseFloat(value.replace(',', '.')) : value, 0, 1e9);
}

export function compileCombatBuild(document, options = {}) {
  const copy = structuredClone(document);
  const build = copy?.build === undefined ? {} : copy.build;
  const doc = normalize(copy, {allowLegacy: true});
  if (!build || typeof build !== 'object' || Array.isArray(build) || !validBuild(doc, build)) {
    throw new Error('Неверное распределение талантов');
  }

  const character = doc.character;
  const maxHealth = character?.hp ?? 10_000;
  const resources = classResources(character).slice(1).map((definition, index) => ({
    ...definition,
    max: character?.resources[index].max ?? 100,
    current: character?.resources[index].current ?? 100,
    color: character?.resources[index].color ?? '#397de1'
  }));
  const resourceNames = new Map(classResources(character).map(resource => [resource.id, resource.name]));
  const activeAbilities = [];
  const passiveAbilities = [];
  const ids = new Set();
  for (const ability of doc.abilities) {
    if (!abilityUnlocked(doc, ability)) continue;
    if (!ability.id || ids.has(ability.id)) throw new Error('Неверный идентификатор способности');
    ids.add(ability.id);
    const compiled = {
      ...ability,
      cast: duration(ability.cast),
      cooldown: duration(ability.cooldown),
      combatEffects: ability.combatEffects ?? [],
      resourceCosts: abilityResourceCosts(ability, character).map(cost => ({
        ...cost,
        resourceName: resourceNames.get(cost.resourceId) || cost.resourceName
      }))
    };
    (ability.kind === 'passive' ? passiveAbilities : activeAbilities).push(compiled);
  }

  return {
    name: doc.name, icon: doc.classIcon, health: maxHealth, maxHealth, resources,
    points: total(doc), budget: doc.budget,
    primaryBranch: doc.branches.find(branch => branch.id === doc.primaryBranchId)?.name,
    stats: normalizeCombatSettings(options).stats, activeAbilities, passiveAbilities
  };
}
