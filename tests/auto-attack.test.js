import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoAttack} from '../static/combat/auto-attack.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {combatAnalytics} from '../static/combat/combat-state.js';

test('swing clock waits for contact, repeats and rechecks visibility and target life', () => {
  let reason = 'outOfRange';
  let hits = 0;
  let poses = 0;
  const events = [];
  const report = (type, details) => events.push([type, details?.reason]);
  const delivery = {validate: () => reason, autoPose: () => poses++, autoContact: () => !reason};
  const auto = createAutoAttack({swingSeconds: 2, windupSeconds: 0.25});
  const advance = time => auto.update(time, delivery, report, () => hits++);
  auto.start(report);
  advance(0);
  advance(9);
  assert.equal(hits, 0);
  assert.equal(auto.status.reason, 'outOfRange');
  reason = undefined;
  advance(10);
  advance(11.8);
  assert.equal(poses, 1);
  assert.equal(hits, 0);
  reason = 'obstructed';
  advance(12);
  assert.equal(hits, 0);
  assert.ok(events.some(([type, cause]) => type === 'attackMissed' && cause === 'obstructed'));
  reason = undefined;
  for (const time of [13, 14.8, 15, 16.8, 17]) advance(time);
  assert.equal(hits, 2);
  reason = 'dummyDead';
  advance(18);
  assert.equal(auto.status.active, false);
  auto.start(report);
  auto.stop();
  reason = undefined;
  advance(20);
  assert.equal(hits, 2);
});

test('actual autoattack results share damage statistics without altering cast or cooldown state', () => {
  const strike = {id: 'swing', name: 'Swing', icon: 'inv_sword_04', combatEffects: [
    {id: 'physical', type: 'damage', trigger: 'onHit', baseAmount: 55, coefficient: 0,
      scalingStat: 'none', school: 'physical', canCrit: true}
  ]};
  const spell = {...strike, id: 'spell', name: 'Spell', cast: 3, cooldown: 8,
    resourceCosts: [{resourceId: 'mana', amount: 5}]};
  const runtime = createCombatRuntime({health: 100, maxHealth: 100, stats: {critChance: 1}, activeAbilities: [spell],
    resources: [{id: 'mana', max: 100, current: 100}]}, {globalCooldown: 1.5, random: () => 0});
  runtime.cast('spell');
  const cast = runtime.state.activeCast;
  runtime.advance(2);
  runtime.autoImpact(strike, {}, 0);
  assert.equal(runtime.state.activeCast, cast);
  assert.equal(runtime.state.globalCooldownUntil, 0);
  assert.deepEqual(runtime.state.cooldowns, {});
  assert.equal(runtime.state.player.resources.mana.current, 100);
  runtime.advance(2);
  assert.equal(runtime.state.player.resources.mana.current, 95);
  const stats = combatAnalytics(runtime.state);
  assert.equal(stats.totalDamage, runtime.state.combatLog.filter(event => event.type === 'damage')
    .reduce((sum, event) => sum + event.amount, 0));
  assert.equal(stats.damageDetails.swing.hits, 1);
  assert.equal(stats.damageDetails.swing.criticalHits, 1);
  assert.equal(stats.damageDetails.spell.hits, 1);
  assert.equal(stats.dps, stats.totalDamage / 2);
  assert.equal(stats.lastDamageAt - stats.damageWindowStart, 3);
  runtime.clearLog();
  assert.equal(combatAnalytics(runtime.state).totalDamage, stats.totalDamage);
});
