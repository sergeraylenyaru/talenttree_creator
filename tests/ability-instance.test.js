import {detachLegacyBuilds} from '../static/combat/build-snapshots.js';
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
  detachLegacyBuilds(doc);
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

test('a personal template copies its transitive proc payloads and cooldown references without a shared record',async()=>{
  const {replaceAbilityInstance}=await import('../static/combat/ability-instance.js');
  const source=blank(),fire=copyAbility(fireball()),payload=copyAbility(fireball());
  payload.name='Payload';payload.kind='passive';payload.combatEffects[0].baseAmount=25;
  fire.combatEffects.push({id:'reset',type:'cooldown',trigger:'onCast',abilityId:payload.id,seconds:1,reset:true});
  source.abilities=[fire,payload];
  source.rpg.procs=[{id:'extra',name:'Extra',owner:{kind:'ability',id:fire.id},event:'damage',chance:1,cooldown:0,spell:payload.id,effect:payload.combatEffects[0].id}];
  const template=abilityTemplateSnapshot(source,fire);
  assert.equal(template.templateAbilities.length,1);
  const imported=appendAbilityInstance(blank(),copyAbility(template));
  assert.doesNotThrow(()=>normalize(imported.document));
  const dependency=imported.document.abilities.find(ability=>ability.id!==imported.ability.id);
  assert.equal(imported.document.rpg.procs[0].spell,dependency.id);
  assert.equal(imported.document.rpg.procs[0].owner.id,imported.ability.id);
  assert.equal(imported.ability.combatEffects[1].abilityId,dependency.id);
  dependency.combatEffects[0].baseAmount=900;
  assert.equal(payload.combatEffects[0].baseAmount,25);
  assert.equal(template.templateAbilities[0].combatEffects[0].baseAmount,25);
  const existing=copyAbility(fireball());
  const doc=blank();doc.abilities=[existing];
  const replacement=replaceAbilityInstance(doc,copyAbility(template,existing.id));
  assert.equal(replacement.abilities[0].id,existing.id);
  assert.equal(replacement.abilities[0].templateRules,undefined);
  assert.doesNotThrow(()=>normalize(replacement));
});

test('importing a detached bundle adapts costs, resource effects, finishers and proc costs together',async()=>{
  const {adaptResourceCosts}=await import('../static/resource-costs.js');
  const doc=blank();doc.character.resources[0].id='custom-mana';
  const source=copyAbility(fireball());source.resourceCosts=[{resourceId:'mana',resourceName:'Mana',amount:10,unit:'points'}];
  source.workshop={version:1,finisherResource:'mana'};
  source.combatEffects.push({id:'gain',type:'resource',trigger:'onCast',resourceId:'mana',amount:5,unit:'points'});
  source.templateRules={procs:[{id:'proc',name:'Proc',owner:{kind:'ability',id:source.id},event:'damage',chance:1,cooldown:0,
    spell:source.id,effect:source.combatEffects[0].id,cost:{resourceId:'mana',amount:1,unit:'points'}}],bonuses:[]};
  const adapted=adaptResourceCosts(source,doc.character);
  assert.equal(adapted.resourceCosts[0].resourceId,'custom-mana');
  assert.equal(adapted.combatEffects[1].resourceId,'custom-mana');
  assert.equal(adapted.workshop.finisherResource,'custom-mana');
  assert.equal(adapted.templateRules.procs[0].cost.resourceId,'custom-mana');
  assert.equal(source.resourceCosts[0].resourceId,'mana');
  assert.doesNotThrow(()=>normalize(appendAbilityInstance(doc,adapted).document));
});

test('copied proc dependencies unlock with their owning node and are removed with that instance',async()=>{
  const {abilityUnlocked,removeAbility}=await import('../static/engine.js');
  const doc=blank(),main=copyAbility(fireball()),payload=copyAbility(fireball());
  payload.kind='passive';doc.abilities=[main,payload];
  doc.rpg.procs=[{id:'proc',name:'Proc',owner:{kind:'ability',id:main.id},event:'damage',chance:1,cooldown:0,sourceAbilityId:main.id,spell:payload.id,effect:payload.combatEffects[0].id}];
  const copied=copyAbilityIntoDocument(doc,main);
  const dependency=copied.document.abilities.find(ability=>ability.instanceOwnerId===copied.ability.id);
  assert.ok(dependency);
  const placed=placeAbilityTalent(copied.document,copied.ability.id,doc.branches[0].id,0,0);
  assert.equal(abilityUnlocked(placed,dependency),false);
  placed.build[placed.branches[0].talents[0].id]=1;
  assert.equal(abilityUnlocked(placed,dependency),true);
  const removed=removeAbility(placed,copied.ability.id);
  assert.equal(removed.abilities.some(ability=>ability.id===dependency.id),false);
  assert.doesNotThrow(()=>normalize(removed));
});

test('portable resource names prevent a legacy mana slot from silently becoming rage',async()=>{
  const {adaptResourceCosts}=await import('../static/resource-costs.js');
  const source=copyAbility(fireball());source.resourceCosts=[{resourceId:'legacy:0',resourceName:'Mana',amount:10,unit:'points'}];
  const imported=adaptResourceCosts(source,{resources:[{name:'Rage'}]});
  assert.equal(imported.resourceCosts[0].resourceId,'');
});
