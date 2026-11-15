import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {blank,normalize,placeAbilityTalent,synchronizeAbilityTalents,validateCombatEffects} from '../static/engine.js';
import {withoutBuild} from '../static/browser-build.js';
import {adaptResourceCosts} from '../static/resource-costs.js';
const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/combat-effects.json',import.meta.url)));
const damage=fixtures.valid[1][0],healing=fixtures.valid[2][0];
function doc(effects){const d=blank();d.abilities=[{id:'ability',name:'Fireball',description:'Text',icon:'spell_fire_flamebolt',...(effects===undefined?{}:{combatEffects:effects})}];return d;}
for(const [i,effects] of fixtures.valid.entries())test(`combat effect variant ${i} and JSON round trip`,()=>{assert.deepEqual(normalize(JSON.parse(JSON.stringify(doc(effects)))).abilities[0].combatEffects,effects);});
for(const patch of fixtures.invalidPatches)test(`rejects ${JSON.stringify(patch)}`,()=>assert.throws(()=>normalize(doc([{...damage,...patch}]))));
test('rejects malformed arrays, duplicate IDs, missing fields, non-finite numbers and excessive effects',()=>{
 for(const effects of [null,{},'text',[null],[[damage]],[damage,damage],Array.from({length:33},(_,i)=>({...damage,id:`e-${i}`})),[{...damage,baseAmount:NaN}],[{...damage,coefficient:Infinity}],[{...healing,school:'holy'}]])assert.throws(()=>normalize(doc(effects)));
 for(const key of Object.keys(damage)){const e={...damage};delete e[key];assert.throws(()=>validateCombatEffects({combatEffects:[e]}));}
});
test('all schools and limits are accepted; IDs are unique within an ability',()=>{
 const effects=['physical','fire','frost','arcane','nature','shadow','holy'].map((school,i)=>({...damage,id:`e-${i}`,school,baseAmount:1e9,coefficient:1000}));
 assert.doesNotThrow(()=>normalize(doc(effects)));assert.doesNotThrow(()=>normalize(doc(Array.from({length:32},(_,i)=>({...healing,id:`e-${i}`})))));
});
test('legacy abilities retain the absent optional field',()=>assert.equal(Object.hasOwn(normalize(doc()).abilities[0],'combatEffects'),false));
test('editing, synchronization, public builds and favorite adaptation preserve independent effects',()=>{
 const source=doc([damage,healing]);let d=placeAbilityTalent(source,'ability',source.branches[0].id,0,0);
 d.abilities[0]={...d.abilities[0],name:'Edited',description:'Updated'};
 synchronizeAbilityTalents(d);d=normalize(JSON.parse(JSON.stringify(d)));
 assert.equal(d.branches[0].talents[0].name,'Edited');
 assert.deepEqual(d.abilities[0].combatEffects,[damage,healing]);
 assert.deepEqual(withoutBuild(d).abilities[0].combatEffects,[damage,healing]);
 const favorite=adaptResourceCosts(structuredClone(d.abilities[0]),undefined);
 assert.deepEqual(favorite.combatEffects,[damage,healing]);favorite.combatEffects[0].baseAmount=99;
 assert.equal(d.abilities[0].combatEffects[0].baseAmount,120);
});
