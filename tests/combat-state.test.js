import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCombatSettings} from '../static/combat/build-compiler.js';
import {applyCombatResult, combatAnalytics, createCombatState, spendResources} from '../static/combat/combat-state.js';

const ability = {id: 'a'};
const build = {health: 100, maxHealth: 100, resources: [{id: 'custom', current: 2, max: 5}]};
const initial = () => createCombatState(build, normalizeCombatSettings({dummy: {maxHealth: 50}}));

test('initial state takes player health, custom resources and dummy maximum from inputs', () => {
  const state = initial();
  assert.equal(state.player.health, 100);
  assert.equal(state.player.resources.custom.current, 2);
  assert.equal(state.player.resources.custom.max, 5);
  assert.equal(state.dummy.health, 50);
  assert.equal(state.combatTime, 0);
  assert.deepEqual(state.combatLog, []);
});

test('payment fails atomically and health always retains one point', () => {
  const {player} = initial();
  const costs = [{resourceId: 'health', amount: 99}, {resourceId: 'custom', amount: 3}];
  assert.deepEqual(spendResources(player, costs), {failedCost: costs[1]});
  assert.deepEqual(spendResources(player, [{resourceId: 'health', amount: 100}]).failedCost, {resourceId: 'health', amount: 100});
  assert.equal(player.health, 100);
  assert.equal(player.resources.custom.current, 2);
  const paid = spendResources(player, [costs[0], {resourceId: 'custom', amount: 2}]).player;
  assert.equal(paid.health, 1);
  assert.equal(paid.resources.custom.current, 0);
});

test('damage caps at remaining HP, records overkill and counts only applied damage', () => {
  const start = initial();
  const hit = applyCombatResult(start, ability, {type: 'damage', finalAmount: 60, isCritical: true});
  assert.equal(start.dummy.health, 50);
  assert.equal(hit.state.dummy.health, 0);
  assert.equal(hit.amount, 50);
  assert.equal(hit.overkill, 10);
  assert.equal(hit.state.statistics.totalDamage, 50);
  assert.equal(hit.state.statistics.damageByAbility.a, 50);
  assert.equal(combatAnalytics(hit.state).dps, 0);
  assert.equal(combatAnalytics({...hit.state, combatTime: 2}).dps, 25);
  assert.equal(combatAnalytics(hit.state).criticalPercent, 100);
});

test('healing restores only missing player health and records overhealing', () => {
  const state = initial();
  state.player = spendResources(state.player, [{resourceId: 'health', amount: 25}]).player;
  const healed = applyCombatResult(state, ability, {type: 'healing', finalAmount: 40, isCritical: false});
  assert.equal(healed.state.player.health, 100);
  assert.equal(healed.state.dummy.health, 50);
  assert.equal(healed.state.statistics.totalHealing, 40);
  assert.equal(healed.state.statistics.effectiveHealing, 25);
  assert.equal(healed.state.statistics.overhealing, 15);
  assert.deepEqual(initial(), initial());
});
