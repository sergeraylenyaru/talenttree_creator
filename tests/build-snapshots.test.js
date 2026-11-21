import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,normalize} from '../static/engine.js';
import {copyAbility} from '../static/combat/ability-instance.js';
import {workshopTemplates} from '../static/spell-workshop.js';
import {saveBuildSnapshot,restoreBuildSnapshot,detachLegacyBuilds} from '../static/combat/build-snapshots.js';

test('saved builds detach every ability, resource, proc and item and survive document reload',()=>{
  const doc=blank();
  doc.abilities=[copyAbility(workshopTemplates().find(a=>a.name==='Fireball'))];
  doc.rpg.equipped={};
  const first=saveBuildSnapshot(doc,'First');
  doc.rpg.builds=[first];
  doc.abilities[0].combatEffects[0].baseAmount=500;
  const second=saveBuildSnapshot(doc,'Second');doc.rpg.builds.push(second);
  doc.abilities[0].combatEffects[0].baseAmount=700;
  doc.character.resources[0].max=200;
  const persisted=normalize(JSON.parse(JSON.stringify(doc)));
  assert.equal(first.combatSnapshot.abilities[0].combatEffects[0].baseAmount,150);
  assert.equal(second.combatSnapshot.abilities[0].combatEffects[0].baseAmount,500);
  assert.equal(first.combatSnapshot.character.resources[0].max,100);
  const restored=normalize(restoreBuildSnapshot(persisted,persisted.rpg.builds[0]));
  assert.equal(restored.abilities[0].combatEffects[0].baseAmount,150);
  assert.equal(restored.rpg.builds.length,2);
  restored.abilities[0].combatEffects[0].baseAmount=900;
  assert.equal(restored.rpg.builds[0].combatSnapshot.abilities[0].combatEffects[0].baseAmount,150);
  assert.deepEqual(restored.rpg.builds[1].combatSnapshot.rpg.builds,[]);
});

test('legacy saved builds acquire independent snapshots without changing any existing ID or value',()=>{
  const doc=blank();doc.rpg.builds=[{id:'old',name:'Old',talents:{},equipped:{}}];
  const before=structuredClone(doc);
  detachLegacyBuilds(doc);
  assert.equal(doc.rpg.builds[0].id,'old');
  assert.deepEqual(doc.abilities,before.abilities);
  const snapshot=doc.rpg.builds[0].combatSnapshot;
  detachLegacyBuilds(doc);
  assert.equal(doc.rpg.builds[0].combatSnapshot,snapshot);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(doc))),doc);
  const recursive=structuredClone(doc);recursive.rpg.builds[0].combatSnapshot.rpg.builds=[before.rpg.builds[0]];
  assert.throws(()=>normalize(recursive),/snapshot/);
});
