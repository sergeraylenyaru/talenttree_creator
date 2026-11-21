export function createCombatState(build, settings) {
  return {
    player: {
      health: build.health, maxHealth: build.maxHealth,
      resources: Object.fromEntries(build.resources.map(resource => [resource.id, {...resource}]))
    },
    dummy: {...settings.dummy, health: settings.dummy.maxHealth},
    cooldowns: {},cooldownGroups:{},
    globalCooldownUntil: 0,
    activeCast: null,
    classStates:{...build.profile?.states},combatTime: 0,
    statistics: {
      firstDamageAt: null, damageWindowStart: null, lastDamageAt: null, totalDamage: 0, totalHealing: 0, effectiveHealing: 0,
      overhealing: 0, criticalHits: 0, effects: 0, casts: 0, damageByAbility: {}, damageDetails: {}
    },
    combatLog: []
  };
}

export function spendResources(player, costs) {
  const next = {...player, resources: {...player.resources}};
  for (const cost of costs) {
    if (cost.amount === 0) continue;
    if (cost.resourceId === 'health') {
      if (next.health - cost.amount < 1) return {failedCost: cost};
      next.health -= cost.amount;
      continue;
    }
    const resource = Object.hasOwn(next.resources, cost.resourceId) && next.resources[cost.resourceId];
    if (!resource || resource.current < cost.amount) return {failedCost: cost};
    next.resources[cost.resourceId] = {...resource, current: resource.current - cost.amount};
  }
  return {player: next};
}

export function applyCombatResult(state, ability, result, startedAt = state.combatTime) {
  const {statistics} = state;
  const next = {
    ...state,
    statistics: {
      ...statistics, effects: statistics.effects + 1,
      criticalHits: statistics.criticalHits + Number(result.isCritical)
    }
  };
  if (result.type === 'damage') {
    const amount = Math.min(state.dummy.health, result.finalAmount);
    const previous = Object.hasOwn(statistics.damageByAbility, ability.id)
      ? statistics.damageByAbility[ability.id] : 0;
    next.dummy = {...state.dummy, health: state.dummy.health - amount};
    next.statistics.totalDamage += amount;
    if (amount > 0) {
      next.statistics.firstDamageAt ??= state.combatTime;
      next.statistics.damageWindowStart = Math.min(startedAt, statistics.damageWindowStart ?? startedAt);
      next.statistics.lastDamageAt = state.combatTime;
      const details = Object.hasOwn(statistics.damageDetails, ability.id)
        ? statistics.damageDetails[ability.id] : {name: ability.name, icon: ability.icon, hits: 0, criticalHits: 0};
      next.statistics.damageDetails = {...statistics.damageDetails, [ability.id]: {
        ...details, hits: details.hits + 1, criticalHits: details.criticalHits + Number(result.isCritical)
      }};
      next.statistics.damageByAbility = {...statistics.damageByAbility, [ability.id]: previous + amount};
    }
    return {state: next, amount, overkill: result.finalAmount - amount};
  }

  const amount = result.finalAmount;
  const effective = Math.min(state.player.maxHealth - state.player.health, amount);
  next.player = {...state.player, health: state.player.health + effective};
  next.statistics.totalHealing += amount;
  next.statistics.effectiveHealing += effective;
  next.statistics.overhealing += amount - effective;
  return {state: next, amount, effective, overhealing: amount - effective};
}

export function combatAnalytics(state) {
  const stats = state.statistics;
  const elapsed = stats.firstDamageAt === null ? 0 : state.combatTime - stats.firstDamageAt;
  return {
    ...stats,
    dps: elapsed > 0 ? stats.totalDamage / elapsed : 0,
    criticalPercent: stats.effects ? stats.criticalHits / stats.effects * 100 : 0
  };
}
