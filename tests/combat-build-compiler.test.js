import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCombatBuild, normalizeCombatSettings} from '../static/combat/build-compiler.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/training-grounds.json', import.meta.url)));

test('compiler preserves the source and uses the selected ranks, ability IDs and effects', () => {
  const document = fixture();
  const original = structuredClone(document);
  const build = compileCombatBuild(document);
  assert.deepEqual(document, original);
  assert.equal(build.name, 'Training Mage');
  assert.equal(build.health, 1000);
  assert.equal(build.points, 1);
  assert.deepEqual(build.activeAbilities.map(a => a.id), ['flame', 'heal']);
  assert.deepEqual(build.passiveAbilities.map(a => a.id), ['passive']);
  assert.deepEqual(build.activeAbilities[0].combatEffects, document.abilities[0].combatEffects);
  assert.notEqual(build.activeAbilities[0].combatEffects, document.abilities[0].combatEffects);
  document.build = {'locked-talent': 1};
  assert.deepEqual(compileCombatBuild(document).activeAbilities.map(a => a.id), ['heal', 'locked']);
});

test('compiler preserves resource definitions and resolves modern and legacy costs', () => {
  const build = compileCombatBuild(fixture(), {stats: {spellPower: 200, schoolDamageMultipliers: {fire: 1.2}}});
  assert.deepEqual(build.resources.map(r => [r.id, r.current, r.max, r.unit]), [
    ['mana', 80, 100, 'points'], ['charges', 2, 5, 'count'],
    ['energy', 100, 100, 'points'], ['rage', 0, 100, 'points']
  ]);
  assert.deepEqual(build.activeAbilities[0].resourceCosts.map(c => [c.resourceId, c.amount, c.unit]), [
    ['mana', 20, 'percent'], ['health', 100, 'points'], ['charges', 1, 'count']
  ]);
  assert.deepEqual(build.activeAbilities[1].resourceCosts, [
    {resourceId: 'mana', resourceName: 'Mana', amount: 5, unit: 'points'}
  ]);
  assert.equal(build.stats.spellPower, 200);
  assert.equal(build.stats.schoolDamageMultipliers.fire, 1.2);
  assert.equal(build.stats.critChance, 0.1);
});

test('compiler rejects invalid documents and selected builds before normalization can clear them', () => {
  for (const build of [null, 1, [], {unknown: 1}, {'fire-talent': 2}]) {
    assert.throws(() => compileCombatBuild({...fixture(), build}), /распределение/);
  }
  assert.throws(() => compileCombatBuild({...fixture(), version: 2}), /формат/);
});

test('legacy classes without a character use editor defaults and old timing strings', () => {
  const document = fixture();
  delete document.character;
  delete document.abilities[0].resourceCosts;
  delete document.abilities[1].resourceType;
  document.abilities[1].cast = '1,5 сек.';
  const build = compileCombatBuild(document);
  assert.equal(build.maxHealth, 10_000);
  assert.equal(build.resources[0].current, 100);
  assert.equal(build.activeAbilities[1].cast, 1.5);
});

test('settings ignore invalid and unknown saved values', () => {
  const settings = normalizeCombatSettings({
    stats: {critChance: 5, attackPower: '12', schoolDamageMultipliers: {fire: 0, bad: 12}},
    dummy: {maxHealth: 0, armor: -3, resistances: {nature: 50}}, globalCooldown: 0
  });
  assert.equal(settings.stats.critChance, 0.1);
  assert.equal(settings.stats.attackPower, 0);
  assert.equal(settings.stats.schoolDamageMultipliers.fire, 0);
  assert.equal(settings.stats.schoolDamageMultipliers.bad, undefined);
  assert.equal(settings.dummy.maxHealth, 1_000_000);
  assert.equal(settings.dummy.armor, 0);
  assert.equal(settings.dummy.resistances.nature, 50);
  assert.equal(settings.globalCooldown, 0);
});
