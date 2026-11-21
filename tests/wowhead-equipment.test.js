import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,normalize} from '../static/engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {importedItemCopy} from '../static/wowhead-item-import.js';
import {itemEligibility,validateItem} from '../static/combat/rpg-profile.js';
import {normalizedWeaponSpeed} from '../static/combat/attack-rules.js';

const source={provider:'wowhead',version:'cataclysm',itemId:900001,url:'https://www.wowhead.com/cata/item=900001',fetchedAt:'2026-11-21T00:00:00Z',responseSha256:'a'.repeat(64),inventorySlot:13,subclass:7,tooltipText:'Fixture description',imported:['name','stats.strength'],unmodeled:['tooltipEffects']};
const sword=()=>({id:'sword',name:'Fixture sword',icon:'inv_sword_04',level:100,quality:'legendary',slot:'mainHand',allowedSlots:['mainHand','offHand'],type:'sword1',requiredLevel:60,requiredClasses:['warrior','paladin'],minDamage:100,maxDamage:140,speed:2,stats:{strength:20,stamina:30},source:structuredClone(source)});
const ring=()=>({id:'ring',name:'Fixture ring',icon:'inv_misc_questionmark',level:100,quality:'rare',slot:'ring1',allowedSlots:['ring1','ring2'],type:'ring',stats:{agility:25},source:{...source,inventorySlot:11,subclass:0}});

test('confirmation and repeated import create independent deep copies without equipping or replacing',()=>{
 const preview=sword(),a=importedItemCopy(preview),b=importedItemCopy(preview);
 assert.notEqual(a.id,b.id);assert.notEqual(a.id,preview.id);a.stats.strength=500;a.source.unmodeled.push('custom');
 assert.equal(b.stats.strength,20);assert.equal(preview.stats.strength,20);assert.deepEqual(b.source.unmodeled,['tooltipEffects']);
});

test('paired slots permit distinct copies but reject the same instance and unique-equipped duplicates',()=>{
 const a=ring(),b={...ring(),id:'ring-copy'};const profile={level:85,restrictions:{}};
 assert.equal(itemEligibility(b,'ring2',profile,{ring1:a}),'');assert.match(itemEligibility(a,'ring2',profile,{ring1:a}),/already equipped/);
 a.uniqueGroup=b.uniqueGroup='wowhead-cata-900001';assert.match(itemEligibility(b,'ring2',profile,{ring1:a}),/Unique-equipped/);
});

test('imported hand, two-handed, holdable, level and multiple class restrictions survive normalization',()=>{
 const profile={level:85,combatRules:{classId:'warrior'},restrictions:{dualWield:false}};const item=sword();
 assert.equal(itemEligibility(item,'mainHand',profile), '');assert.match(itemEligibility(item,'offHand',profile),/Dual wield/);
 assert.match(itemEligibility(item,'mainHand',{...profile,level:59}),/level/i);assert.match(itemEligibility(item,'mainHand',{...profile,combatRules:{classId:'mage'}}),/class/);
 const hold={id:'book',name:'Book',type:'holdable',slot:'offHand',level:85,quality:'rare',icon:'forge-arcane',stats:{intellect:50}};validateItem(hold);
 assert.equal(itemEligibility(hold,'offHand',profile,{}),'');assert.match(itemEligibility(hold,'offHand',profile,{mainHand:{type:'axe2'}}),/two-handed/);
 const mainOnly={...item,allowedSlots:['mainHand']};assert.match(itemEligibility(mainOnly,'offHand',{...profile,restrictions:{dualWield:true}}),/slot/);
 for(const type of ['axe2','mace2','polearm']){validateItem({...item,type,allowedSlots:['mainHand']});assert.equal(normalizedWeaponSpeed({type}),3.3);}
 assert.equal(normalizedWeaponSpeed({type:'gun'}),2.8);
});

test('equipping imported statistics and a weapon feeds the existing character sheet and real combat calculation',()=>{
 const doc=blank();doc.rpg={version:1,level:85,attributes:{hitRating:10000,expertiseRating:10000},combatRules:{version:'cataclysm-4.3.4',classId:'warrior',targetLevel:85,position:'behind'},items:[sword()],equipped:{}};
 doc.abilities=[{id:'strike',name:'Weapon strike',icon:'forge-steel',description:'Fixture attack',kind:'active',learningMode:'base',cast:0,cooldown:0,range:2,resourceCosts:[],workshop:{version:1,noGcd:true,attackType:'melee',weaponHand:'mainHand'},combatEffects:[{id:'hit',type:'damage',trigger:'onHit',school:'physical',baseAmount:0,weaponCoefficient:1,scalingStat:'none',coefficient:0,canCrit:false}]}];
 const run=doc=>createCombatRuntime(compileCombatBuild(normalize(doc)),{random:()=>.5});
 const before=run(doc);assert.equal(before.sheet().source.attackPower,0);
 doc.rpg.equipped.mainHand='sword';const after=run(doc);assert.equal(after.sheet().primary.strength,20);assert.equal(after.sheet().source.attackPower,40);assert.equal(after.sheet().maxHealth-before.sheet().maxHealth,160);
 after.cast('strike');assert.equal(after.state.statistics.totalDamage,126); // (100+140)/2 + 40/14*2, rounded once.
 const persisted=normalize(JSON.parse(JSON.stringify(doc)));assert.deepEqual(persisted.rpg.items,doc.rpg.items);assert.equal(run(persisted).sheet().source.attackPower,40);
});

test('the server-facing document rejects contradictory imported slots and duplicate equipped instances',()=>{
 const doc=blank();doc.rpg={version:1,level:85,items:[ring()],equipped:{ring1:'ring',ring2:'ring'}};
 assert.throws(()=>normalize(doc),/already equipped/);doc.rpg.equipped={ring2:'ring'};assert.equal(normalize(doc).rpg.equipped.ring2,'ring');
});
