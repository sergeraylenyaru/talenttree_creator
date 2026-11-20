import test from 'node:test';
import assert from 'node:assert/strict';
import {copyAbility,copyAbilityIntoDocument,abilityTemplateSnapshot,appendAbilityInstance} from '../static/combat/ability-instance.js';
import {blank,normalize,placeAbilityTalent,moveTalent} from '../static/engine.js';
import {workshopTemplates,rememberTemplate,personalTemplates} from '../static/spell-workshop.js';

const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const fireball=()=>workshopTemplates().find(ability=>ability.name==='Fireball');

test('two mages, duplicates and saved personal templates own all nested configuration',()=>{
  const source=fireball();
  assert.equal(source.combatEffects[0].baseAmount,150);
  const a=copyAbility(source), b=copyAbility(source);
  a.combatEffects[0].baseAmount=500;
  a.presentation.projectile='homing';
  assert.equal(b.combatEffects[0].baseAmount,150);
  assert.equal(fireball().combatEffects[0].baseAmount,150);
  assert.notEqual(a.id,b.id);
  rememberTemplate(a,'first');
  const saved=personalTemplates('first')[0];
  a.combatEffects[0].baseAmount=900;
  assert.equal(saved.combatEffects[0].baseAmount,500);
  assert.deepEqual(personalTemplates('second'),[]);
  const c=copyAbility(saved);
  c.combatEffects[0].baseAmount=1;
  assert.equal(personalTemplates('first')[0].combatEffects[0].baseAmount,500);
  const duplicate=copyAbility(a);
  duplicate.presentation.projectile='none';
  assert.equal(a.presentation.projectile,'homing');
  assert.deepEqual(duplicate.templateSource,{id:a.id,name:a.name});
});

test('placement copies preserve combat rules and moving an old node preserves IDs, builds and settings',()=>{
  let doc=blank();
  const source=copyAbility(fireball());
  source.kind='passive';
  doc.abilities=[source];
  doc.rpg.procs=[{id:'proc',owner:{kind:'passive',id:source.id},name:'Extra flame',event:'spellHit',
    chance:.2,cooldown:3,spell:source.id,effect:'damage'}];
  const result=copyAbilityIntoDocument(doc,source);
  assert.notEqual(result.ability.id,source.id);
  assert.equal(result.document.rpg.procs[1].spell,result.ability.id);
  assert.equal(result.document.rpg.procs[1].owner.id,result.ability.id);
  result.document.rpg.procs[1].chance=.8;
  assert.equal(doc.rpg.procs[0].chance,.2);
  delete doc.rpg.procs;
  doc=placeAbilityTalent(doc,source.id,doc.branches[0].id,0,0);
  const node=doc.branches[0].talents[0];
  doc.build[node.id]=1;
  doc.rpg.builds=[{id:'one',name:'One',talents:{...doc.build},equipped:{}},
    {id:'two',name:'Two',talents:{...doc.build},equipped:{}}];
  const persisted=normalize(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(persisted,doc);
  const moved=moveTalent(persisted,node.id,doc.branches[0].id,0,1);
  assert.equal(moved.branches[0].talents[0].grantedAbilityId,source.id);
  assert.deepEqual(moved.abilities,doc.abilities);
  assert.deepEqual(moved.rpg.builds,doc.rpg.builds);
  assert.deepEqual(moved.build,doc.build);
});

test('saved templates carry detached proc and bonus snapshots into another document',()=>{
  const doc=blank(), source=copyAbility(fireball());
  doc.abilities=[source];
  doc.rpg.bonuses=[{id:'bonus',owner:{kind:'talent',id:'old'},spell:source.id,stat:'damage',amount:10}];
  const template=abilityTemplateSnapshot(doc,source);
  const draft=copyAbility(template);
  const result=appendAbilityInstance(blank(),draft);
  assert.equal(result.document.rpg.bonuses[0].spell,draft.id);
  assert.equal(result.document.rpg.bonuses[0].amount,10);
  assert.deepEqual(result.document.rpg.bonuses[0].owner,{kind:'ability',id:draft.id});
  assert.doesNotThrow(()=>normalize(result.document));
  assert.equal(result.ability.templateRules,undefined);
  result.document.rpg.bonuses[0].amount=500;
  assert.equal(template.templateRules.bonuses[0].amount,10);
});
