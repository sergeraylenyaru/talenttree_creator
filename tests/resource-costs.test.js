import test from 'node:test';
import assert from 'node:assert/strict';
import {classResources,abilityResourceCosts,validateResourceCosts,reconcileResourceCosts,adaptResourceCosts} from '../static/resource-costs.js';
import {blank,normalize,changeRank,validBuild,abilityUnlocked} from '../static/engine.js';
import {withoutBuild,saveBrowserBuild,restoreBrowserBuild} from '../static/browser-build.js';
const character=()=>({hp:1000,race:'Человек',gender:'Мужской',armory:'',resources:[{id:'blood',name:'Кровь',max:100,current:0,unit:'points',display:'bar',shape:'diamond',color:'#aa0000'},{id:'stars',name:'Звёзды',max:5,current:5,unit:'count',display:'icons',shape:'star',color:'#ccaa00'}]});
const cost=(resourceId,amount,unit='points')=>({resourceId,amount,unit});
test('costs use only class resources and health, with independent amounts and units',()=>{
 const c=character(),a={resourceCosts:[cost('blood',20),cost('health',5,'percent'),cost('stars',2,'count')]};
 assert.deepEqual(classResources(c).map(r=>r.id),['health','blood','stars']);assert.doesNotThrow(()=>validateResourceCosts(a,c));
 for(const invalid of [[cost('mana',5)],[cost('blood',-1)],[cost('health',Infinity)],[cost('blood',5),cost('blood',6)],[cost('stars',2,'bad')]])assert.throws(()=>validateResourceCosts({resourceCosts:invalid},c));
 assert.deepEqual(classResources({resources:[]}).map(r=>r.id),['health']);assert.doesNotThrow(()=>validateResourceCosts({resourceCosts:[]},c));
});
test('old single costs open against actual class resources, without adding unrelated choices',()=>{
 const c=character();assert.equal(abilityResourceCosts({resourceType:'Кровь',resource:25,resourceUnit:'percent'},c)[0].resourceId,'blood');
 assert.equal(abilityResourceCosts({resourceType:'Ярость',resource:25},c)[0].resourceId,'');assert.equal(classResources(c).length,3);
 assert.equal(abilityResourceCosts({resourceType:'Mana',resource:10},undefined)[0].resourceId,'legacy:0');
});
test('renames preserve cost references; deleting used resources refuses without losing costs',()=>{
 const before=character(),next=structuredClone(before);next.resources[0].name='Жизненная кровь';const a={name:'Удар',resourceCosts:[cost('blood',20)]};
 const updated=reconcileResourceCosts([a],before,next)[0];assert.equal(updated.resourceCosts[0].resourceName,'Жизненная кровь');assert.equal(a.resourceCosts[0].resourceName,undefined);
 next.resources.shift();assert.throws(()=>reconcileResourceCosts([a],before,next),/Удар/);
 const portable=adaptResourceCosts({...a,resourceCosts:[{...a.resourceCosts[0],resourceName:'Кровь'}]},{resources:[{id:'new',name:'Кровь'}]});assert.equal(portable.resourceCosts[0].resourceId,'new');
});
function spec(){const d=blank();d.specialization={requiredPoints:31};d.branches[0].talents=[{id:'a',name:'A',row:0,col:0,icon:'inv_misc_book_09',maxRank:31,descriptions:Array(31).fill('A'),requires:''}];d.branches[1].talents=[{id:'b',name:'B',row:0,col:0,icon:'inv_misc_book_09',maxRank:5,descriptions:Array(5).fill('B'),requires:''}];return d;}
test('Cata primary selection grants abilities immediately and gates other trees at 31 points',()=>{
 const d=spec(),a={branchId:d.branches[0].id,learningMode:'specialization'};assert.equal(changeRank(d,'a',1),false);assert.equal(abilityUnlocked(d,a),false);
 d.primaryBranchId=d.branches[0].id;assert.equal(abilityUnlocked(d,a),true);assert.equal(changeRank(d,'b',1),false);
 for(let i=0;i<31;i++)assert.equal(changeRank(d,'a',1),true);assert.equal(changeRank(d,'b',1),true);assert.equal(changeRank(d,'a',-1),false);assert.equal(changeRank(d,'b',-1),true);assert.equal(changeRank(d,'a',-1),true);assert.equal(validBuild(d,d.build),true);
});
test('primary choice and points stay browser-local; other visitors and exports start empty',()=>{
 const d=spec();d.primaryBranchId=d.branches[0].id;d.build={a:4};const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};saveBrowserBuild(d,'share:one',storage);
 const restored=restoreBrowserBuild(d,'share:one',storage);assert.equal(restored.primaryBranchId,d.primaryBranchId);assert.deepEqual(restored.build,{a:4});
 const fresh=restoreBrowserBuild(d,'share:two',storage);assert.equal(fresh.primaryBranchId,undefined);assert.deepEqual(fresh.build,{});assert.equal(withoutBuild(d).primaryBranchId,undefined);
});
test('multi-resource costs survive JSON normalization and validate namespaced resource IDs',()=>{
 const d=blank();d.character=character();d.abilities=[{id:'x',name:'Skill',icon:'inv_misc_book_09',description:'D',cast:0,cooldown:0,range:0,resourceCosts:[cost('health',3,'percent'),cost('blood',12)]}];assert.equal(normalize(structuredClone(d)).abilities[0].resourceCosts.length,2);
 const bad=structuredClone(d);bad.character.resources[1].id='blood';assert.throws(()=>normalize(bad),/ресурс/);
});
