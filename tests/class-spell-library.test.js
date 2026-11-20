import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Scene} from 'three';
import {blank,normalize} from '../static/engine.js';
import {classTemplateLabels,installStarterLibrary,templateClassForPreset} from '../static/combat/class-spell-templates.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {effectPresets} from '../static/combat/effect-presets.js';
import {createCombatVisuals} from '../static/world/combat/combat-visuals.js';
import {abilityReadiness} from '../static/combat/ability-readiness.js';

const options={seed:5,stats:{attackPower:100,spellPower:100,critChance:0},globalCooldown:0};
const create=doc=>createCombatRuntime(compileCombatBuild(doc,options),options);
const read=name=>JSON.parse(readFileSync(new URL('../static/presets/'+name+'.json',import.meta.url)));

function prepare(key){
  const base=blank();
  delete base.character;
  const doc=installStarterLibrary(base,key,'ru');
  const primary=doc.character.resources[0];
  primary.current=Math.ceil(primary.max/2);
  doc.rpg.incoming={school:'physical',amount:300};
  return doc;
}

test('all 82 localized templates execute through the same combat runtime and can be saved',()=>{
  let count=0;
  const resourceKinds=new Set();
  for(const key of Object.keys(classTemplateLabels)){
    const doc=prepare(key),normal=normalize(JSON.parse(JSON.stringify(doc)));
    assert.deepEqual(normal,doc);
    assert.deepEqual(installStarterLibrary(doc,key,'en'),doc,'Existing edited templates keep their identity');
    const id=doc.character.resources[0].id;
    resourceKinds.add(id);
    for(const ability of doc.abilities){
      const rt=create(doc);
      if(ability.kind==='passive'){
        const without=create({...doc,abilities:doc.abilities.filter(a=>a.id!==ability.id)});
        if(key==='rogue')assert.ok(rt.sheet().source.critChance>without.sheet().source.critChance);
        else{
          const attack=doc.abilities[0];
          rt.cast(attack.id);
          without.cast(attack.id);
          assert.ok(rt.state.dummy.health<without.state.dummy.health);
        }
      }else{
        const isHeal=ability.combatEffects.some(e=>e.type==='healing');
        if(isHeal)rt.incoming();
        const {player,dummy}=rt.state;
        assert.equal(rt.cast(ability.id).ok,true,ability.id);
        rt.advance(9);
        if(ability.combatEffects.some(e=>e.type==='damage')) assert.ok(rt.state.dummy.health<dummy.health,ability.id);
        if(isHeal){
          assert.ok(rt.state.player.health>player.health,ability.id);
          assert.ok(rt.state.statistics.totalHealing>0);
        }
        if(ability.combatEffects.some(e=>e.type==='resource')) assert.ok(rt.state.player.resources[id].current>player.resources[id].current);
        if(ability.combatEffects.some(e=>e.type==='shield')){
          const immediate=create(doc);
          immediate.cast(ability.id);
          immediate.incoming();
          assert.ok(immediate.state.player.health>immediate.state.player.maxHealth-300);
        }
        if(ability.combatEffects.some(e=>e.type==='status')){
          const immediate=create(doc);
          immediate.cast(ability.id);
          const attack=doc.abilities[0];
          immediate.cast(attack.id);
          const baseline=create(doc);
          baseline.cast(attack.id);
          assert.ok(immediate.state.dummy.health<baseline.state.dummy.health);
        }
        if(ability.resourceCosts.length){
          assert.ok(rt.state.player.resources[id].current<player.resources[id].current);
          assert.ok(rt.state.combatLog.some(e=>e.type==='resourceSpent'));
        }
      }
      count++;
    }
  }
  assert.equal(count,82);
  assert.equal(resourceKinds.size,5);
});

test('all metadata-only presets can receive a starter set with no edits to their talent nodes',()=>{
  let count=0;
  for(const preset of read('index')){
    const doc=read(preset.id);
    if(doc.abilities.length)continue;
    const installed=installStarterLibrary(doc,templateClassForPreset(preset.id),'en');
    assert.ok(installed.abilities.length>0,preset.id);
    assert.deepEqual(installed.branches,doc.branches);
    assert.deepEqual(installed.build,doc.build);
    assert.doesNotThrow(()=>normalize(installed));
    count++;
  }
  assert.equal(count,28);
});

test('the old catalog remains available and adapted healing and movement change their actual values',()=>{
  for(const [preset,spell,event] of [
    ['cata-druid','cata-druid-2-spec-18562','healing'],
    ['cata-shaman','cata-shaman-2-spec-974','healing'],
    ['cata-rogue','cata-rogue-2-spec-36554','statusApplied']
  ]){
    const doc=normalize(read(preset));
    const ability=doc.abilities.find(a=>a.id===spell);
    assert.equal(abilityReadiness(doc,ability).state,'partial');
    doc.primaryBranchId=ability.branchId;
    doc.rpg={version:1,incoming:{school:'physical',amount:1000}};
    for(const pool of doc.character.resources)pool.current=pool.max;
    const rt=create(doc);
    rt.incoming();
    const start=rt.state.player.health;
    assert.equal(rt.cast(spell).ok,true);
    rt.advance(event==='healing'?4:1);
    if(event==='healing')assert.ok(rt.state.player.health>start);
    else assert.ok(rt.sheet().movementSpeed>1);
    assert.ok(rt.state.combatLog.some(e=>e.type===event&&e.abilityId===spell));
  }
});

test('each of the 21 effect presets creates and releases procedural geometry',()=>{
  const scene=new Scene();
  const visuals=createCombatVisuals(scene,{rotation:{x:0}});
  assert.equal(Object.keys(effectPresets).length,21);
  const geometries=new Set();
  for(const effectPreset of Object.keys(effectPresets)){
    const profile={effectPreset,effectScale:1.4,effectSpeed:2,opacity:.5,effectIntensity:1.2};
    const projectile=visuals.spawn({x:1,y:0,z:0},profile,.3);
    geometries.add(projectile.geometry.type);
    visuals.remove(projectile);
    visuals.impact({x:0,y:1,z:0},profile);
    assert.ok(scene.children.length>0,effectPreset);
    assert.equal(scene.children[0].material.opacity,.6);
    visuals.update(5);
    assert.equal(scene.children.length,0);
  }
  assert.ok(geometries.size>=4);
  visuals.dispose();
});
