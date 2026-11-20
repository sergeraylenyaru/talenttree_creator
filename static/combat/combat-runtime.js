import {addStatus, modifier, nextStatusBoundary} from './active-effects.js';
import {isHostileEffect} from './workshop-rules.js';
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
  const emptyEffects = [];
  let statuses = emptyEffects;
  const charges = new Map();

  function chargeState(ability) {
    const {charges: limit, recharge = 10} = ability.workshop ?? {};
    if (!limit) return {};
    const now = state.combatTime;
    const remaining = (charges.get(ability.id) ?? []).filter(at => at > now);
    return {limit, recharge, remaining};
  }

  function pay(ability, payment, costs, events, keepCast = false) {
    for (const cost of costs) if (cost.amount) events.push(entry('resourceSpent', ability, cost));
    const pool = chargeState(ability);
    if (pool.limit) {
      charges.set(ability.id, [...pool.remaining, (pool.remaining.at(-1) ?? state.combatTime) + pool.recharge]);
    }
    const gcd = ability.workshop?.noGcd ? 0 : ability.workshop?.gcdDuration ?? settings.globalCooldown;
    state = {
      ...state, player: payment.player, activeCast: keepCast ? state.activeCast : null,
      globalCooldownUntil: Math.max(state.globalCooldownUntil, state.combatTime + gcd),
      cooldowns: {...state.cooldowns, [ability.id]: state.combatTime + ability.cooldown},
      statistics: {...state.statistics, casts: state.statistics.casts + 1}
    };
    return gcd;
  }

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
    const gcd = ability.workshop?.noGcd ? 0 : Math.max(0, state.globalCooldownUntil - state.combatTime);
    const pool = chargeState(ability);
    if (pool.limit && pool.remaining.length >= pool.limit) return {reason: 'cooldown', remaining: pool.remaining[0] - state.combatTime};
    if (cooldown || gcd) return {reason: cooldown >= gcd ? 'cooldown' : 'gcd', remaining: Math.max(cooldown, gcd)};
    if (!state.dummy.health && ability.combatEffects.some(isHostileEffect) && !['area','ground'].includes(ability.presentation?.targeting)) {
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
    const followsImpact = effect => isHostileEffect(effect) || effect.trigger === 'onHit' && Boolean(ability.workshop);
    const zoneEffects = delivery?.ground ? ordered.filter(effect => effect.type === 'damage' && effect.interval) : [];
    const delayed = spatialDamage ? ordered.filter(effect=>followsImpact(effect) && !zoneEffects.includes(effect)) : [];
    let results;
    try {
      results = calculate(spatialDamage ? ordered.filter(effect => !followsImpact(effect)) : ordered, ability);
    } catch (error) {
      state = {...state, activeCast: null};
      delivery?.cancel?.();
      log([entry('calculationFailed', ability, {message: error.message})]);
      return {ok: false, reason: 'calculationFailed'};
    }

    const events = [entry('castCompleted', ability)];
    const gcd = pay(ability, payment, costs, events);
    applyResults([...results,...calculate(zoneEffects, ability)], ability, events, startedAt, delivery);
    if (ability.cooldown || gcd) events.push(entry('cooldownStarted', ability, {amount: ability.cooldown, globalCooldown: gcd}));
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
            const results = calculate(delayed, ability);
            applyResults(results, ability, entries, startedAt, delivery);
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

  function calculate(effects, ability, stacked = 1, pulse = false) {
    const stat = key => modifier(statuses, 'player', key);
    const rank = ability.rankMultiplier ?? 1;
    const source = {
      ...build.stats,
      damageMultiplier: (build.stats.damageMultiplier ?? 1) * rank,
      healingMultiplier: (build.stats.healingMultiplier ?? 1) * rank,
      attackPower: (build.stats.attackPower ?? 0) * Math.max(0, 1 + stat('attackPower')),
      spellPower: (build.stats.spellPower ?? 0) * Math.max(0, 1 + stat('spellPower')),
      critChance: Math.max(0, Math.min(1, (build.stats.critChance ?? 0) + stat('critChance')))
    };
    const targetModifier = key => Math.max(0, 1 + modifier(statuses, 'dummy', key));
    return effects.map(effect => {
      if (effect.type === 'resource' || effect.type === 'status' || effect.duration && !pulse) return {effect};
      const result = calculateCombatEffect(effect, {
        source,
        target: effect.type === 'damage' ? {
          armor: state.dummy.armor * targetModifier('armor'), resistances: state.dummy.resistances,
          damageTakenMultiplier: state.dummy.damageTakenMultiplier * targetModifier('damageTaken')
        } : {healingTakenMultiplier: settings.healingTakenMultiplier * Math.max(0, 1 + stat('healingTaken'))},
        outcome: {isCritical: effect.canCrit && rollCritical(source.critChance, random()),
          ...(effect.minAmount !== undefined || effect.maxAmount !== undefined ? {amountRoll:random()} : {})}
      });
      const finalAmount = result.finalAmount * stacked;
      if (!Number.isSafeInteger(finalAmount)) throw new RangeError('Stacked result exceeds safe integer precision');
      return {...result, finalAmount};
    });
  }

  function applyResults(results, ability, events, startedAt, delivery) {
    for (const result of results) {
      if (result.effect) {
        const effect = result.effect;
        if (effect.type === 'resource') {
          const resource = Object.hasOwn(state.player.resources, effect.resourceId) && state.player.resources[effect.resourceId];
          if (!resource) continue;
          const amount = Math.min(resource.max - resource.current, effect.amount * (effect.unit === 'percent' ? resource.max / 100 : 1));
          state = {...state, player: {...state.player, resources: {...state.player.resources,
            [effect.resourceId]: {...resource, current: resource.current + amount}}}};
          if (amount) events.push(entry('resourceGained', ability, {amount, resourceName: resource.name}));
          continue;
        }
        const hostile = isHostileEffect(effect);
        if (hostile && !state.dummy.health && !delivery?.ground) continue;
        statuses = addStatus(statuses, ability, effect, state.combatTime, delivery);
        events.push(entry('statusApplied', ability, {statusName: effect.name ?? ability.name, amount: effect.duration}));
        delivery?.sound?.(hostile ? ability.workshop?.debuffSound : ability.workshop?.buffSound);
        continue;
      }
      const wasAlive = state.dummy.health > 0;
      const applied = applyCombatResult(state, ability, result, startedAt);
      state = applied.state;
      const {amount, effective, overhealing, overkill} = applied;
      if (result.type === 'damage' && amount <= 0) continue;
      events.push(entry(result.type, ability, {
        amount, effective, overhealing, overkill, school: result.school, icon: ability.icon, effectId: result.effectId, isCritical: result.isCritical
      }));
      if (wasAlive && !state.dummy.health) events.push(entry('targetDefeated', ability));
      if (effective) delivery?.sound?.(ability.workshop?.healSound);
      if (!state.dummy.health) statuses = statuses.filter(status => status.target !== 'dummy');
      if (overhealing) events.push(entry('overhealing', ability, {amount: overhealing, isCritical: result.isCritical}));
    }
  }

  function tickStatuses() {
    const now = state.combatTime;
    const events = [];
    for (const status of statuses) {
      if (status.nextTick > now || status.nextTick > status.expires ||
          status.target === 'dummy' && !state.dummy.health) continue;
      status.nextTick += status.effect.interval;
      try {
        if (status.target === 'zone' && status.delivery?.pulse?.() === false) continue;
        applyResults(calculate([status.effect], status.ability, status.stacks, true), status.ability, events, undefined, status.delivery);
      } catch (error) {
        events.push(entry('calculationFailed', status.ability, {message: error.message}));
      }
    }
    statuses = statuses.filter(status => {
      if (status.expires > now) return true;
      status.removeVisual?.();
      return false;
    });
    if (events.length) log(events);
  }

  function channelTick(cast) {
    const {ability, delivery, costs, startedAt} = cast;
    const rejection = delivery?.validate();
    const payment = !cast.paid && spendResources(state.player, costs);
    if (rejection || payment?.failedCost) {
      cancelCast(true);
      log([entry('castRejected', ability, {reason: rejection ?? 'insufficient'})]);
      return;
    }
    const events = [];
    try {
      const hit = delivery?.pulse?.() !== false;
      const results = calculate(hit ? ability.combatEffects : ability.combatEffects.filter(effect => !isHostileEffect(effect)), ability);
      if (!cast.paid) {
        const gcd = pay(ability, payment, costs, events, true);
        if (ability.cooldown || gcd) events.push(entry('cooldownStarted', ability, {amount: ability.cooldown, globalCooldown: gcd}));
      }
      applyResults(results, ability, events, startedAt, delivery);
      delivery?.sound?.(ability.workshop.tickSound);
      const nextTick = cast.nextTick + ability.workshop.tickInterval;
      state = {...state, activeCast: {...cast, paid: true, nextTick}};
    } catch (error) {
      cancelCast(true);
      events.push(entry('calculationFailed', ability, {message: error.message}));
    }
    if (events.length) log(events);
  }

  function cancelCast(force = false) {
    if (!state.activeCast) return false;
    const {ability, delivery} = state.activeCast;
    if (ability.workshop?.uninterruptible && !force) return false;
    delivery?.cancel?.();
    state = {...state, activeCast: null};
    log([entry('castCancelled', ability)]);
    return true;
  }

  return {
    get state() { return state; },
    get paused() { return paused; },
    get statuses() { return statuses; },
    movementScale() { return Math.max(.1, 1 + modifier(statuses, 'player', 'movementSpeed')); },
    chargeCount(id) {
      const pool = chargeState(abilities.get(id) ?? {});
      return pool.limit ? pool.limit - pool.remaining.length : undefined;
    },
    availability,
    autoEvent(ability, type, details) { log([entry(type, ability, details)]); },
    autoImpact(ability, delivery, startedAt) {
      if (paused || !state.dummy.health) return;
      const events = [entry('autoHit', ability)];
      try {
        const results = calculate(ability.combatEffects, ability);
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
      const rejection = ability.presentation?.targeting === 'ground' && !delivery ? 'groundTarget' : delivery?.validate();
      if (rejection) {
        log([entry('castRejected', ability, {reason: rejection})]);
        return {ok: false, reason: rejection};
      }
      status.delivery = delivery;
      status.startedAt = state.combatTime;
      log([entry('castStarted', ability)]);
      delivery?.sound?.(ability.workshop?.activationSound);
      const channel = ability.channelDuration ?? ability.presentation?.channelDuration ?? 0;
      if (!ability.cast && !channel) return finish(status);
      const castEnd = state.combatTime + ability.cast;
      state = {...state, activeCast: {...status, start: state.combatTime, castEnd,
        end: castEnd + channel, channeling: !ability.cast,
        nextTick: ability.workshop?.tickInterval ? castEnd + ability.workshop.tickInterval : Infinity}};
      if (ability.cast) {
        delivery?.sound?.(ability.workshop?.castSound);
        delivery?.prepare?.(ability.cast, state.combatTime);
      }
      else delivery?.channel?.(channel, state.combatTime);
      return {ok: true};
    },
    advance(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('Invalid combat time delta');
      if (paused) return;
      const end = state.combatTime + deltaSeconds;
      for (;;) {
        const cast = state.activeCast;
        const boundary = Math.min(nextStatusBoundary(statuses), cast?.end ?? Infinity,
          cast?.nextTick ?? Infinity, cast && !cast.channeling && cast.castEnd < cast.end ? cast.castEnd : Infinity);
        if (boundary > end) break;
        state = {...state, combatTime: boundary};
        if (nextStatusBoundary(statuses) <= boundary) tickStatuses();
        if (!cast) continue;
        if (!cast.channeling && cast.castEnd < cast.end && boundary === cast.castEnd) {
          state = {...state, activeCast: {...cast, channeling: true}};
          if (end < cast.end) cast.delivery?.channel?.(cast.end - boundary, boundary);
          continue;
        }
        if (cast.ability.workshop?.tickInterval) {
          if (boundary >= cast.nextTick) channelTick(cast);
          if (boundary >= cast.end && state.activeCast) {
            state = {...state, activeCast: null};
            log([entry('castCompleted', cast.ability)]);
          }
        } else if (boundary >= cast.end) finish(cast);
      }
      if (end !== state.combatTime) state = {...state, combatTime: end};
    },
    cancel: cancelCast,
    moved() {
      if (state.activeCast?.ability.workshop?.interruptMovement) cancelCast(true);
    },
    resetTarget() {
      this.cancelSpatial();
      statuses = statuses.filter(status => status.target !== 'dummy');
      state = {...state, dummy: {...state.dummy, health: state.dummy.maxHealth}};
      log([entry('targetRestored', {id: '', name: ''})]);
    },
    cancelSpatial() {
      pending.clear();
      statuses = statuses.filter(status => {
        if (status.target !== 'zone') return true;
        status.removeVisual?.();
        return false;
      });
      if (state.activeCast?.delivery) cancelCast(true);
    },
    setPaused(value) { paused = Boolean(value); },
    reset() {
      pending.clear();
      for (const status of statuses) status.removeVisual?.();
      statuses = emptyEffects;
      charges.clear();
      state = createCombatState(build, settings);
      paused = false;
    },
    clearLog() { state = {...state, combatLog: []}; }
  };
}
