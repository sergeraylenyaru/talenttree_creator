import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,normalize,validBuild} from '../static/engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {deriveCharacterStats} from '../static/combat/character-stats.js';
import {rollItemStats} from '../static/combat/item-roll.js';
import {validateItem} from '../static/combat/rpg-profile.js';

test('custom level progression adds class attributes, health and resources without modifying saved base values',()=>{
  const doc=blank();doc.rpg.progression={baseLevel:60,healthPerLevel:20,attributesPerLevel:{intellect:2},resourcePerLevel:{'legacy:0':5}};
  const base=deriveCharacterStats(compileCombatBuild(doc));doc.rpg.level=65;
  const high=deriveCharacterStats(compileCombatBuild(normalize(doc)));
  assert.equal(high.primary.intellect,base.primary.intellect+10);
  assert.equal(high.maxHealth,base.maxHealth+100);
  assert.equal(high.resources[0].max,base.resources[0].max+25);
  assert.equal(doc.rpg.attributes.intellect,74);
  doc.rpg.progression.resourcePerLevel={unknown:1};assert.throws(()=>normalize(doc),/progression resource/);
});

test('random item tuning is seeded, persisted once and repeatable without compounding previous rolls',()=>{
  const item={id:'head',name:'Head',icon:'forge-steel',slot:'head',type:'plate',quality:'rare',level:85,
    stats:{strength:100,critChance:.2}};
  const rolled=rollItemStats(item,13);
  assert.ok(rolled.stats.strength>=80&&rolled.stats.strength<=120);
  assert.deepEqual(rollItemStats(rolled,13),rolled);
  assert.deepEqual(item.stats,{strength:100,critChance:.2});
  assert.deepEqual(JSON.parse(JSON.stringify(rolled)),rolled);assert.doesNotThrow(()=>validateItem(rolled));
  assert.throws(()=>validateItem({...rolled,roll:{seed:1,spread:.2,baseStats:{unknown:1}}}),/statistic/);
});

test('talent ranks respect their optional level requirement',()=>{
  const doc=blank(),node={id:'advanced',name:'Advanced',icon:'forge-arcane',row:0,col:0,maxRank:1,descriptions:['Advanced'],requiredLevel:70};
  doc.branches[0].talents=[node];
  assert.equal(validBuild(doc,{advanced:1}),false);doc.rpg.level=70;assert.equal(validBuild(doc,{advanced:1}),true);
});
