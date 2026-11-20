import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {box} from '../static/world/collision-system.js';
import {attackProfile, createSpatialCombat, distanceToTarget, facingTarget, sphereImpact, sweptTargetImpact, validateAttack} from '../static/world/combat/spatial-combat.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/training-grounds.json', import.meta.url)));

function arena({range = 0, health = 1000, obstacles = [], cast = 0, trigger = 'onHit', presentation} = {}) {
  const doc = fixture();
  const ability = doc.abilities[0];
  ability.range = range;
  ability.cast = cast;
  if (presentation) ability.presentation = presentation;
  ability.combatEffects = [{...ability.combatEffects[0], trigger}];
  const options = {dummy: {maxHealth: health}, stats: {critChance: 0}, globalCooldown: 0};
  let rolls = 0;
  const runtime = createCombatRuntime(compileCombatBuild(doc, options), {...options, random: () => { rolls++; return 0.5; }});
  const player = {x: 0, y: 0, z: 0};
  const victim = {position: {x: 0, y: 1.25, z: -2.5}, radius: 0.72};
  let selected = true, exists = true;
  const view = {animations: [], hits: 0, removed: 0, facing: null};
  const target = {selected: () => selected, read: () => exists ? {...victim, alive: runtime.state.dummy.health > 0} : null};
  const world = createSpatialCombat({
    player: () => player, target: () => selected ? target : null, areaTarget: () => target, obstacles,
    face: position => { view.facing = facingTarget(player, position); },
    animate: name => view.animations.push(name),
    visuals: {
      spawn: () => ({}), remove: () => view.removed++, move() {},
      impact: () => view.hits++
    }
  });
  const castAbility = () => runtime.cast('flame', world.delivery);
  const advance = dt => {
    runtime.advance(dt);
    if (!runtime.paused) world.update(runtime.state.combatTime);
  };
  return {runtime, world, player, victim, view, castAbility, advance,
    select: value => { selected = value; }, disappear: () => { exists = false; }, rolls: () => rolls};
}

test('range uses the target volume and reports unavailable, defeated and occluded targets', () => {
  const origin = {x: 0, y: 1, z: 4};
  const target = {position: {x: 0, y: 1, z: 0}, radius: 1, alive: true};
  assert.equal(distanceToTarget(origin, target), 3);
  assert.equal(validateAttack(origin, target, {range: 3}, []), undefined);
  assert.equal(validateAttack(origin, target, {range: 2.9}, []), 'outOfRange');
  assert.equal(validateAttack(origin, target, {range: 3}, [box(0, 2, 1, 1, 2)]), 'obstructed');
  assert.equal(validateAttack(origin, null, {range: 3}, []), 'invalidTarget');
  assert.equal(validateAttack(origin, {...target, alive: false}, {range: 3}, []), 'dummyDead');
  assert.equal(facingTarget(origin, {x: 1, z: 4}), -Math.PI / 2);
  assert.equal(sphereImpact(origin, {x: 0, y: 0, z: -8}, target), 3 / 8);
});

test('melee animates and pays once, then rolls and deals damage only on contact', () => {
  const a = arena();
  assert.equal(a.castAbility().ok, true);
  assert.deepEqual(a.view.animations, ['meleeAttack']);
  assert.equal(a.view.facing, 0);
  assert.equal(a.runtime.state.player.resources.mana.current, 60);
  assert.equal(a.castAbility().reason, 'cooldown');
  a.advance(0.29);
  assert.equal(a.runtime.state.dummy.health, 1000);
  assert.equal(a.rolls(), 0);
  a.advance(0.02);
  a.advance(1);
  assert.equal(a.runtime.state.dummy.health, 900);
  assert.equal(a.rolls(), 1);
  assert.equal(a.runtime.state.statistics.damageByAbility.flame, 100);
  const types = a.runtime.state.combatLog.map(event => event.type);
  assert.equal(types.filter(type => type === 'attackHit').length, 1);
  assert.ok(types.indexOf('attackHit') < types.indexOf('damage'));
});

test('invalid casts preserve resources and a cast leaving range before release pays nothing', () => {
  const a = arena({cast: 0.5});
  a.select(false);
  assert.equal(a.castAbility().reason, 'invalidTarget');
  a.select(true);
  a.player.z = 3;
  assert.equal(a.castAbility().reason, 'outOfRange');
  a.player.z = 0;
  assert.equal(a.castAbility().ok, true);
  a.player.z = 3;
  a.advance(0.5);
  assert.equal(a.runtime.state.player.resources.mana.current, 80);
  assert.equal(a.runtime.state.statistics.casts, 0);
  assert.equal(a.runtime.state.combatLog.at(-1).reason, 'outOfRange');
});

test('projectiles travel on the combat clock and resolve swept contact', () => {
  const a = arena({range: 18});
  a.victim.position.z = -8;
  assert.equal(a.castAbility().ok, true);
  a.advance(0.2);
  assert.equal(a.world.snapshot()[0].position.z, -2);
  assert.equal(a.runtime.state.dummy.health, 1000);
  a.runtime.setPaused(true);
  a.advance(1);
  assert.equal(a.world.snapshot()[0].position.z, -2);
  a.runtime.setPaused(false);
  a.advance(0.7);
  assert.equal(a.runtime.state.dummy.health, 900);
  assert.equal(a.view.removed, 1);
  assert.equal(a.view.hits, 1);
  assert.equal(a.world.snapshot().length, 0);
});

test('a moved or removed target, or an occluder, ends a projectile without damage', () => {
  const wall = box(1, -3, 1, 1, 3);
  for (const outcome of ['moved', 'removed', 'blocked']) {
    const a = arena({range: 18, obstacles: outcome === 'blocked' ? [wall] : []});
    a.victim.position.z = -8;
    assert.equal(a.castAbility().ok, true);
    if (outcome === 'moved') a.victim.position.x = 8;
    if (outcome === 'removed') a.disappear();
    if (outcome === 'blocked') wall.minX = -0.5;
    a.advance(3);
    assert.equal(a.runtime.state.dummy.health, 1000);
    assert.equal(a.runtime.state.combatLog.at(-1).type, 'attackMissed');
    assert.equal(a.view.removed, 1);
  }
});

test('instant ranged damage, target defeat/reset and 2D ability execution use the same runtime', () => {
  const a = arena({range: 12, health: 80, trigger: 'onCast'});
  assert.equal(attackProfile({range: 12, combatEffects: [{type: 'damage', trigger: 'onCast'}]}).kind, 'instant');
  a.castAbility();
  assert.equal(a.runtime.state.dummy.health, 0);
  a.advance(5);
  assert.equal(a.castAbility().reason, 'dummyDead');
  a.runtime.resetTarget();
  assert.equal(a.runtime.state.dummy.health, 80);
  assert.equal(a.runtime.state.statistics.totalDamage, 80);
  assert.equal(a.runtime.cast('flame').ok, true);
  assert.equal(a.runtime.state.dummy.health, 0);
  assert.equal(a.world.snapshot().length, 0);
});

test('mode transitions invalidate all pending impacts and clean their visuals', () => {
  const a = arena({range: 18});
  a.castAbility();
  a.runtime.cancelSpatial();
  a.world.clear();
  a.advance(2);
  assert.equal(a.runtime.state.dummy.health, 1000);
  assert.equal(a.view.removed, 1);
  assert.equal(a.world.snapshot().length, 0);
  assert.equal(a.runtime.state.player.resources.mana.current, 60);
});

test('runtime rejects duplicate impact callbacks even from a faulty delivery adapter', () => {
  const a = arena();
  assert.equal(a.runtime.cast('flame', () => ({
    validate() {}, launch(_, resolve) { resolve('hit'); resolve('hit'); }
  })).ok, true);
  assert.equal(a.runtime.state.dummy.health, 900);
  assert.equal(a.runtime.state.statistics.casts, 1);
});

test('preparation and channeling keep payment deferred and cancellation releases the cast', () => {
  const a = arena({cast: 0.5, range: 18, presentation: {
    channelDuration: 2, castingAnimation: 'cast', projectile: 'none'
  }});
  assert.equal(a.castAbility().ok, true);
  a.advance(0.6);
  assert.deepEqual(a.view.animations, ['spellCast', 'channel']);
  assert.equal(a.runtime.state.player.resources.mana.current, 80);
  a.runtime.cancel();
  a.advance(3);
  assert.equal(a.runtime.state.player.resources.mana.current, 80);
  assert.equal(a.runtime.state.dummy.health, 1000);
  assert.equal(a.castAbility().ok, true);
  a.advance(2.5);
  assert.equal(a.runtime.state.player.resources.mana.current, 60);
  assert.equal(a.runtime.state.dummy.health, 900);
  assert.equal(a.runtime.state.combatLog.filter(event => event.type === 'castCompleted').length, 1);
});

test('presentation speed affects travel and only homing tracks a moving victim', () => {
  for (const projectile of ['straight', 'homing']) {
    const a = arena({range: 18, presentation: {delivery: 'ranged', projectile, projectileSpeed: 5}});
    a.victim.position.z = -7;
    assert.equal(a.castAbility().ok, true);
    a.advance(0.2);
    assert.equal(a.world.snapshot()[0].position.z, -1);
    a.victim.position.x = 3;
    a.advance(3);
    assert.equal(a.runtime.state.dummy.health, projectile === 'homing' ? 900 : 1000);
  }
});

test('swept contact uses imported model bounds when available', () => {
  const target = {position: {x: 0, y: 1, z: 0}, radius: 0.72, bounds: {min: [-1, 0, -1], max: [1, 3, 1]}};
  const delta = {x: 0, y: 0, z: -4};
  assert.equal(sweptTargetImpact({x: 0, y: 2.5, z: 2}, delta, target, 0), 0.25);
  assert.equal(sweptTargetImpact({x: 0, y: 3.5, z: 2}, delta, target, 0), Infinity);
});

test('area delivery resolves the arena opponent with no selection but still checks range', () => {
  const a = arena({presentation: {targeting: 'area', projectile: 'none', impact: 'arcane'}});
  a.select(false);
  a.victim.position.z = -9;
  assert.equal(a.castAbility().reason, 'outOfRange');
  assert.equal(a.runtime.state.player.resources.mana.current, 80);
  a.victim.position.z = -5;
  assert.equal(a.castAbility().ok, true);
  assert.equal(a.runtime.state.dummy.health, 900);
  assert.equal(a.runtime.state.player.resources.mana.current, 60);
});

test('manual self-targeted presentation animates without acquiring the dummy', () => {
  const animations = [];
  const world = createSpatialCombat({
    player: () => ({x: 1, y: 0, z: 2}),
    target: () => assert.fail('Self abilities must not acquire the dummy'),
    obstacles: [],
    animate: (...args) => animations.push(args),
    face: point => assert.equal(point, null),
    visuals: {impact: () => {}}
  });
  const delivery = world.delivery({combatEffects: [{type: 'healing'}],
    presentation: {targeting: 'self', animation: 'area'}});
  assert.equal(delivery.utility, true);
  assert.equal(delivery.validate(), undefined);
  delivery.launch(0);
  assert.equal(animations[0][2], 'SpellCastOmni (ID 54 variation 0)');
});
