import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {combatAnalytics} from '../static/combat/combat-state.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/training-grounds.json', import.meta.url)));
const make = (options = {}, document = fixture()) =>
  createCombatRuntime(compileCombatBuild(document, options), {random: () => 0, ...options});

test('instant cast pays all three resource units and resolves onCast before onHit once each', () => {
  let rolls = 0;
  const runtime = make({random: () => { rolls++; return 0; }, dummy: {armor: 4000, resistances: {fire: 4000}}});
  assert.deepEqual(runtime.cast('flame'), {ok: true});
  const {dummy, player, combatLog, statistics} = runtime.state;
  assert.equal(dummy.health, 999890);
  assert.equal(player.health, 900);
  assert.equal(player.resources.mana.current, 60);
  assert.equal(player.resources.charges.current, 1);
  assert.equal(rolls, 1);
  assert.deepEqual(combatLog.map(event => event.type), [
    'castStarted', 'castCompleted', 'resourceSpent', 'resourceSpent', 'resourceSpent',
    'damage', 'damage', 'cooldownStarted'
  ]);
  assert.deepEqual(combatLog.filter(event => event.type === 'damage').map(e => [e.effectId, e.amount, e.isCritical]), [
    ['physical', 10, false], ['fire', 100, true]
  ]);
  assert.ok(combatLog.every(event => event.abilityId === 'flame' && event.time === 0));
  assert.equal(statistics.casts, 1);
  assert.equal(combatAnalytics(runtime.state).criticalPercent, 50);
});

test('cast time yields no effects or payment until completion and timestamps completion exactly', () => {
  const runtime = make();
  runtime.cast('flame');
  assert.equal(runtime.cast('heal').reason, 'gcd');
  runtime.advance(1.5);
  runtime.cast('heal');
  assert.equal(runtime.cast('flame').reason, 'casting');
  runtime.advance(1.99);
  assert.equal(runtime.state.player.health, 900);
  assert.equal(runtime.state.player.resources.mana.current, 60);
  runtime.advance(1);
  assert.equal(runtime.state.player.health, 1000);
  assert.equal(runtime.state.player.resources.mana.current, 55);
  assert.equal(runtime.state.statistics.overhealing, 60);
  assert.equal(runtime.state.statistics.totalHealing, 160);
  assert.equal(runtime.state.cooldowns.heal, 6.5);
  assert.equal(runtime.state.combatLog.find(e => e.type === 'healing').time, 3.5);
});

test('cancelled casts and pauses cannot spend resources or start a cooldown', () => {
  const runtime = make();
  runtime.cast('heal');
  runtime.advance(1);
  runtime.setPaused(true);
  runtime.advance(30);
  assert.equal(runtime.state.combatTime, 1);
  assert.equal(runtime.cast('flame').reason, 'paused');
  runtime.cancel();
  runtime.setPaused(false);
  runtime.advance(2);
  assert.equal(runtime.state.player.resources.mana.current, 80);
  assert.deepEqual(runtime.state.cooldowns, {});
  assert.deepEqual(runtime.state.combatLog.map(e => e.type), ['castStarted', 'castCancelled']);
  assert.equal(runtime.cast('heal').ok, true);
});

test('locked and passive abilities cannot cast; cooldown and GCD expire independently', () => {
  const runtime = make();
  assert.equal(runtime.cast('locked').reason, 'locked');
  assert.equal(runtime.cast('passive').reason, 'locked');
  runtime.cast('flame');
  runtime.advance(1);
  assert.equal(runtime.cast('heal').reason, 'gcd');
  runtime.advance(2);
  assert.equal(runtime.cast('flame').reason, 'cooldown');
  runtime.advance(1);
  assert.equal(runtime.cast('flame').ok, true);
});

test('insufficient count rejects and logs the cast without spending other resources', () => {
  const document = fixture();
  document.character.resources[1].current = 0;
  const runtime = make({}, document);
  const before = runtime.state;
  assert.equal(runtime.cast('flame').reason, 'insufficient');
  assert.equal(runtime.state.player, before.player);
  assert.equal(runtime.state.cooldowns, before.cooldowns);
  assert.equal(runtime.state.globalCooldownUntil, 0);
  assert.equal(runtime.state.combatLog.at(-1).type, 'insufficient');
  assert.equal(runtime.state.combatLog.at(-1).resourceId, 'charges');
});

test('defeat stops damaging abilities, log clearing preserves analytics and reset restores everything', () => {
  const runtime = make({dummy: {maxHealth: 30}, globalCooldown: 0});
  const before = runtime.state;
  runtime.advance(5);
  runtime.cast('flame');
  assert.equal(runtime.state.dummy.health, 0);
  assert.equal(runtime.state.statistics.totalDamage, 30);
  assert.equal(combatAnalytics(runtime.state).dps, 0);
  runtime.advance(5);
  assert.equal(combatAnalytics(runtime.state).dps, 6);
  assert.equal(runtime.cast('flame').reason, 'dummyDead');
  assert.equal(runtime.cast('heal').ok, true);
  runtime.clearLog();
  assert.equal(runtime.state.combatLog.length, 0);
  assert.equal(runtime.state.statistics.casts, 1);
  runtime.reset();
  assert.deepEqual(runtime.state, before);
});

test('calculation failures during a cast leave payment, cooldowns and effects untouched', () => {
  const runtime = make({stats: {damageMultiplier: Number.MAX_SAFE_INTEGER}});
  assert.equal(runtime.cast('flame').reason, 'calculationFailed');
  assert.equal(runtime.state.player.resources.mana.current, 80);
  assert.equal(runtime.state.dummy.health, 1_000_000);
  assert.deepEqual(runtime.state.cooldowns, {});
  assert.equal(runtime.state.statistics.casts, 0);
});
