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
    return {ability, costs, player: payment.player};
  }

  function finish({ability, costs, player, delivery}) {
    const rejection = delivery?.validate();
    if (rejection) {
      state = {...state, activeCast: null};
      log([entry('castRejected', ability, {reason: rejection})]);
      return {ok: false, reason: rejection};
    }
    const ordered = ['onCast', 'onHit'].flatMap(trigger =>
      ability.combatEffects.filter(effect => effect.trigger === trigger));
    const delayed = delivery ? ordered.filter(effect => effect.type === 'damage') : [];
    let results;
    try {
      results = calculate(delivery ? ordered.filter(effect => effect.type !== 'damage') : ordered);
    } catch (error) {
      state = {...state, activeCast: null};
      log([entry('calculationFailed', ability, {message: error.message})]);
      return {ok: false, reason: 'calculationFailed'};
    }

    const events = [entry('castCompleted', ability)];
    for (const cost of costs) {
      if (cost.amount) events.push(entry('resourceSpent', ability, cost));
    }
    state = {
      ...state, player, activeCast: null,
      globalCooldownUntil: state.combatTime + settings.globalCooldown,
      cooldowns: {...state.cooldowns, [ability.id]: state.combatTime + ability.cooldown},
      statistics: {...state.statistics, casts: state.statistics.casts + 1}
    };
    applyResults(results, ability, events);
    if (ability.cooldown || settings.globalCooldown) {
      events.push(entry('cooldownStarted', ability, {amount: ability.cooldown, globalCooldown: settings.globalCooldown}));
    }
    if (delivery) events.push(entry('attackLaunched', ability));
    log(events);
    if (delivery) {
      const token = {};
      pending.add(token);
      delivery.launch(state.combatTime, outcome => {
        if (!pending.delete(token)) return;
        const impact = outcome === 'hit' && state.dummy.health > 0;
        const entries = [entry(impact ? 'attackHit' : 'attackMissed', ability)];
        if (impact) {
          try {
            applyResults(calculate(delayed), ability, entries);
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

  function applyResults(results, ability, events) {
    for (const result of results) {
      const applied = applyCombatResult(state, ability, result);
      state = applied.state;
      const {amount, effective, overhealing, overkill} = applied;
      events.push(entry(result.type, ability, {
        amount, effective, overhealing, overkill, effectId: result.effectId, isCritical: result.isCritical
      }));
      if (overhealing) events.push(entry('overhealing', ability, {amount: overhealing, isCritical: result.isCritical}));
    }
  }

  return {
    get state() { return state; },
    get paused() { return paused; },
    availability,
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
      log([entry('castStarted', ability)]);
      if (!ability.cast) return finish(status);
      state = {...state, activeCast: {...status, start: state.combatTime, end: state.combatTime + ability.cast}};
      delivery?.prepare?.(ability.cast, state.combatTime);
      return {ok: true};
    },
    advance(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid combat time delta');
      if (paused) return;
      const end = state.combatTime + deltaSeconds;
      const cast = state.activeCast;
      if (cast && cast.end <= end) {
        state = {...state, combatTime: cast.end};
        finish(cast);
      }
      if (end !== state.combatTime) state = {...state, combatTime: end};
    },
    cancel() {
      if (!state.activeCast) return;
      const {ability} = state.activeCast;
      state = {...state, activeCast: null};
      log([entry('castCancelled', ability)]);
    },
    resetTarget() {
      this.cancelSpatial();
      state = {...state, dummy: {...state.dummy, health: state.dummy.maxHealth}};
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
