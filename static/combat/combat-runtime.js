import {normalizeCombatSettings} from './build-compiler.js';
import {calculateCombatEffect, rollCritical} from './calculation-engine.js';
import {applyCombatResult, createCombatState, spendResources} from './combat-state.js';

export function createCombatRuntime(build, options = {}) {
  const {random = Math.random} = options;
  const settings = normalizeCombatSettings(options);
  const abilities = new Map(build.activeAbilities.map(ability => [ability.id, ability]));
  let state = createCombatState(build, settings);
  let paused = false;
  let eventId = 0;
  const pending = new Set();

  function entry(type, ability, details = {}) {
    return {
      id: ++eventId, time: state.combatTime, type,
      abilityId: ability.id, abilityName: ability.name, ...details
    };
  }

  function log(events) {
    state = {...state, combatLog: [...state.combatLog, ...events].slice(-300)};
  }

  function availability(id) {
    const ability = abilities.get(id);
    if (!ability) return {reason: 'locked'};
    if (paused) return {reason: 'paused'};
    if (state.activeCast) return {reason: 'casting'};
    const cooldown = Math.max(0, (Object.hasOwn(state.cooldowns, id) ? state.cooldowns[id] : 0) - state.combatTime);
    const gcd = Math.max(0, state.globalCooldownUntil - state.combatTime);
    if (cooldown || gcd) return {reason: cooldown >= gcd ? 'cooldown' : 'gcd', remaining: Math.max(cooldown, gcd)};
    if (!state.dummy.health && ability.combatEffects.some(effect => effect.type === 'damage')) {
      return {reason: 'dummyDead'};
    }

    const costs = ability.resourceCosts.map(cost => {
      const max = cost.resourceId === 'health' ? state.player.maxHealth
        : Object.hasOwn(state.player.resources, cost.resourceId) ? state.player.resources[cost.resourceId].max : 0;
      return {...cost, amount: cost.unit === 'percent' && max ? max * (cost.amount / 100) : cost.amount};
    });
    const payment = spendResources(state.player, costs);
    if (payment.failedCost) return {reason: 'insufficient', ...payment};
    return {ability, costs};
  }

  function finish({ability, costs, delivery, startedAt}) {
    const rejection = delivery?.validate();
    if (rejection) {
      state = {...state, activeCast: null};
      delivery?.cancel?.();
      log([entry('castRejected', ability, {reason: rejection})]);
      return {ok: false, reason: rejection};
    }
    const payment = spendResources(state.player, costs);
    if (payment.failedCost) {
      state = {...state, activeCast: null};
      delivery?.cancel?.();
      log([entry('insufficient', ability, payment.failedCost)]);
      return {ok: false, reason: 'insufficient', failedCost: payment.failedCost};
    }
    const ordered = ['onCast', 'onHit'].flatMap(trigger =>
      ability.combatEffects.filter(effect => effect.trigger === trigger));
    const spatialDamage = delivery && !delivery.utility;
    const delayed = spatialDamage ? ordered.filter(effect => effect.type === 'damage') : [];
    let results;
    try {
      results = calculate(spatialDamage ? ordered.filter(effect => effect.type !== 'damage') : ordered);
    } catch (error) {
      state = {...state, activeCast: null};
      delivery?.cancel?.();
      log([entry('calculationFailed', ability, {message: error.message})]);
      return {ok: false, reason: 'calculationFailed'};
    }

    const events = [entry('castCompleted', ability)];
    for (const cost of costs) {
      if (cost.amount) events.push(entry('resourceSpent', ability, cost));
    }
    state = {
      ...state, player: payment.player, activeCast: null,
      globalCooldownUntil: state.combatTime + settings.globalCooldown,
      cooldowns: {...state.cooldowns, [ability.id]: state.combatTime + ability.cooldown},
      statistics: {...state.statistics, casts: state.statistics.casts + 1}
    };
    applyResults(results, ability, events, startedAt);
    if (ability.cooldown || settings.globalCooldown) {
      events.push(entry('cooldownStarted', ability, {amount: ability.cooldown, globalCooldown: settings.globalCooldown}));
    }
    if (spatialDamage) events.push(entry(delivery.projectile ? 'projectileLaunched' : 'attackLaunched', ability));
    log(events);
    if (delivery?.utility) delivery.launch(state.combatTime);
    if (spatialDamage) {
      const token = {};
      pending.add(token);
      delivery.launch(state.combatTime, (outcome, reason) => {
        if (!pending.delete(token)) return;
        const impact = outcome === 'hit' && state.dummy.health > 0;
        const type = delivery.projectile
          ? (impact ? 'projectileHit' : 'projectileMissed')
          : (impact ? 'attackHit' : 'attackMissed');
        const entries = [entry(type, ability, {reason})];
        if (impact) {
          try {
            const results = calculate(delayed);
            applyResults(results, ability, entries, startedAt);
            if (results.some(result => result.isCritical)) delivery.critical?.();
          } catch (error) {
            entries.push(entry('calculationFailed', ability, {message: error.message}));
          }
        }
        log(entries);
      });
    }
    return {ok: true};
  }

  function calculate(effects) {
    return effects.map(effect => calculateCombatEffect(effect, {
      source: build.stats,
      target: effect.type === 'damage' ? {
        armor: state.dummy.armor, resistances: state.dummy.resistances,
        damageTakenMultiplier: state.dummy.damageTakenMultiplier
      } : {healingTakenMultiplier: settings.healingTakenMultiplier},
      outcome: {isCritical: effect.canCrit && rollCritical(build.stats.critChance, random())}
    }));
  }

  function applyResults(results, ability, events, startedAt) {
    for (const result of results) {
      const wasAlive = state.dummy.health > 0;
      const applied = applyCombatResult(state, ability, result, startedAt);
      state = applied.state;
      const {amount, effective, overhealing, overkill} = applied;
      if (result.type === 'damage' && amount <= 0) continue;
      events.push(entry(result.type, ability, {
        amount, effective, overhealing, overkill, school: result.school, icon: ability.icon, effectId: result.effectId, isCritical: result.isCritical
      }));
      if (wasAlive && !state.dummy.health) events.push(entry('targetDefeated', ability));
      if (overhealing) events.push(entry('overhealing', ability, {amount: overhealing, isCritical: result.isCritical}));
    }
  }

  return {
    get state() { return state; },
    get paused() { return paused; },
    availability,
    autoEvent(ability, type, details) { log([entry(type, ability, details)]); },
    autoImpact(ability, delivery, startedAt) {
      if (paused || !state.dummy.health) return;
      const events = [entry('autoHit', ability)];
      try {
        const results = calculate(ability.combatEffects);
        applyResults(results, ability, events, startedAt);
        if (results.some(result => result.isCritical)) delivery.critical?.();
      } catch (error) {
        events.push(entry('calculationFailed', ability, {message: error.message}));
      }
      log(events);
    },
    cast(id, bindDelivery) {
      const status = availability(id);
      if (status.reason) {
        if (status.reason === 'insufficient') log([entry('insufficient', abilities.get(id), status.failedCost)]);
        return {ok: false, reason: status.reason, failedCost: status.failedCost};
      }
      const {ability} = status;
      const delivery = bindDelivery?.(ability);
      const rejection = delivery?.validate();
      if (rejection) {
        log([entry('castRejected', ability, {reason: rejection})]);
        return {ok: false, reason: rejection};
      }
      status.delivery = delivery;
      status.startedAt = state.combatTime;
      log([entry('castStarted', ability)]);
      const channel = ability.channelDuration ?? 0;
      if (!ability.cast && !channel) return finish(status);
      const castEnd = state.combatTime + ability.cast;
      state = {...state, activeCast: {...status, start: state.combatTime, castEnd,
        end: castEnd + channel, channeling: !ability.cast}};
      if (ability.cast) delivery?.prepare?.(ability.cast, state.combatTime);
      else delivery?.channel?.(channel, state.combatTime);
      return {ok: true};
    },
    advance(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid combat time delta');
      if (paused) return;
      const end = state.combatTime + deltaSeconds;
      let cast = state.activeCast;
      if (cast && cast.end > cast.castEnd && !cast.channeling && cast.castEnd <= end) {
        cast = {...cast, channeling: true};
        state = {...state, activeCast: cast};
        if (end < cast.end) cast.delivery?.channel?.(cast.end - end, end);
      }
      if (cast && cast.end <= end) {
        state = {...state, combatTime: cast.end};
        finish(cast);
      }
      if (end !== state.combatTime) state = {...state, combatTime: end};
    },
    cancel() {
      if (!state.activeCast) return;
      const {ability, delivery} = state.activeCast;
      delivery?.cancel?.();
      state = {...state, activeCast: null};
      log([entry('castCancelled', ability)]);
    },
    resetTarget() {
      this.cancelSpatial();
      state = {...state, dummy: {...state.dummy, health: state.dummy.maxHealth}};
      log([entry('targetRestored', {id: '', name: ''})]);
    },
    cancelSpatial() {
      pending.clear();
      if (state.activeCast?.delivery) this.cancel();
    },
    setPaused(value) { paused = Boolean(value); },
    reset() {
      pending.clear();
      state = createCombatState(build, settings);
      paused = false;
    },
    clearLog() { state = {...state, combatLog: []}; }
  };
}
