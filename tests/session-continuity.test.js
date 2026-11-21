import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {createPauseLeases} from '../static/combat/session-updates.js';
import {createProcEngine} from '../static/combat/proc-engine.js';
import {createResourceRecovery} from '../static/combat/resource-recovery.js';
import {seededRandom} from '../static/combat/session-report.js';
const fixture=()=>{
 const doc=JSON.parse(readFileSync(new URL('./fixtures/training-grounds.json',import.meta.url)));
 doc.rpg={version:1,seed:19};
 doc.abilities=[{id:'bolt',name:'Old bolt',description:'',kind:'active',learningMode:'base',icon:'forge-ember',cast:2,cooldown:4,range:30,
 resourceCosts:[{resourceId:'mana',amount:5,unit:'points'}],workshop:{version:1,noGcd:true},
 combatEffects:[{id:'hit',type:'damage',trigger:'onHit',school:'fire',baseAmount:100,scalingStat:'none',coefficient:0,canCrit:false}]}];return doc;
};
const compile=doc=>compileCombatBuild(doc);
const make=doc=>createCombatRuntime(compile(doc),{seed:19});
const damage=rt=>rt.state.combatLog.filter(e=>e.type==='damage').map(e=>[e.abilityName,e.amount]);

test('nested UI pauses freeze all runtime state and restore either prior pause exactly',()=>{
 for(const initiallyPaused of [false,true]){
  const rt=make(fixture());rt.cast('bolt');rt.advance(.5);rt.setPaused(initiallyPaused);
  let notifications=0;const leases=createPauseLeases({getPaused:()=>rt.paused,setPaused:value=>rt.setPaused(value),sync(){},onChange(){notifications++;}});
  const menu=leases.acquire(),before=rt.inspectSession(),editor=leases.acquire();menu();rt.advance(200);assert.deepEqual(rt.inspectSession(),before);
  editor();editor();assert.equal(rt.paused,initiallyPaused);assert.equal(leases.active,false);assert.equal(notifications,3);
 }
});

test('reconcile preserves an active cast, time, RNG and history; future casts use renamed new amount and cost',()=>{
 const doc=fixture(),rt=make(doc);rt.cast('bolt');rt.advance(.5);rt.setPaused(true);const before=rt.inspectSession();
 doc.abilities[0].name='New bolt';doc.abilities[0].cast=0;doc.abilities[0].combatEffects[0].baseAmount=500;doc.abilities[0].resourceCosts[0].amount=8;
 assert.equal(rt.updateBuild(compile(doc)).ok,true);assert.deepEqual(rt.inspectSession(),before);
 rt.setPaused(false);rt.advance(1.5);assert.deepEqual(damage(rt),[['Old bolt',100]]);assert.equal(rt.state.player.resources.mana.current,75);
 rt.advance(4);rt.cast('bolt');assert.deepEqual(damage(rt),[['Old bolt',100],['New bolt',500]]);assert.equal(rt.state.player.resources.mana.current,67);
});

test('inflight projectile owns original effect and resolves exactly once after source deletion',()=>{
 const doc=fixture();doc.abilities[0].cast=0;const rt=make(doc);let impact;
 rt.cast('bolt',()=>({projectile:true,validate(){},launch(_,callback){impact=callback;}}));
 assert.equal(rt.inspectSession().pending,1);const before=rt.inspectSession();doc.abilities=[];assert.equal(rt.updateBuild(compile(doc)).ok,true);assert.deepEqual(rt.inspectSession(),before);
 impact('hit');impact('hit');assert.deepEqual(damage(rt),[['Old bolt',100]]);assert.equal(rt.cast('bolt').reason,'locked');
});

test('applied DoT keeps stacks, expiration and next tick; future applications receive new settings',()=>{
 const doc=fixture();const a=doc.abilities[0];a.cast=0;a.cooldown=0;Object.assign(a.combatEffects[0],{duration:6,interval:2,stacks:3});
 const rt=make(doc);rt.cast('bolt');rt.cast('bolt');rt.advance(1);const before=rt.inspectSession();
 a.name='New burn';a.combatEffects[0].baseAmount=500;a.combatEffects[0].duration=10;
 rt.updateBuild(compile(doc));assert.deepEqual(rt.inspectSession(),before);rt.advance(1);assert.equal(damage(rt).at(-1)[1],200);
 rt.advance(4);rt.cast('bolt');rt.advance(2);assert.equal(damage(rt).at(-1)[1],500);assert.equal(rt.statuses[0].ability.name,'New burn');
});

test('resource/max health changes clamp without refill, keep CDs and charges; unlock and removal use future lookup',()=>{
 const doc=fixture();doc.abilities[0].cast=0;doc.abilities[0].workshop.charges=2;doc.abilities[0].workshop.recharge=12;
 const rt=make(doc);rt.cast('bolt');rt.advance(.7);const before=rt.inspectSession();
 doc.character.hp=700;doc.character.resources[0].max=60;doc.character.resources[0].current=60;doc.character.resources[0].name='New mana';rt.updateBuild(compile(doc));
 assert.equal(rt.state.player.health,700);assert.equal(rt.state.player.resources.mana.current,60);assert.equal(rt.state.player.resources.mana.name,'New mana');assert.deepEqual(rt.inspectSession().charges,before.charges);assert.deepEqual(rt.state.cooldowns,before.state.cooldowns);
 doc.character.hp=5000;doc.character.resources[0].max=1000;rt.updateBuild(compile(doc));assert.equal(rt.state.player.health,700);assert.equal(rt.state.player.resources.mana.current,60);
 doc.abilities[0].learningMode='talent';doc.abilities[0].talentId='locked-talent';rt.updateBuild(compile(doc));assert.equal(rt.cast('bolt').reason,'locked');
 doc.build['locked-talent']=1;rt.updateBuild(compile(doc));rt.advance(4);assert.equal(rt.cast('bolt').ok,true);
});

test('incompatible class, resource units or seed reject without mutating retained session',()=>{
 for(const mutate of [doc=>doc.rpg.seed++,doc=>doc.character.resources[0].unit='percent',doc=>doc.rpg.combatRules={version:'cataclysm-4.3.4',classId:'mage',targetLevel:60}]){
  const doc=fixture(),rt=make(doc);rt.cast('bolt');rt.advance(.3);const before=rt.inspectSession();mutate(doc);assert.equal(rt.updateBuild(compile(doc)).ok,false);assert.deepEqual(rt.inspectSession(),before);
 }
});

test('proc rules update keeps event deduplication, internal cooldown and used charges',()=>{
 const rule={id:'p',event:'damage',chance:1,cooldown:10,charges:2};const engine=createProcEngine([rule],()=>0);let executions=0;
 const run=(id,time)=>engine.dispatch({id,type:'damage'},{combatTime:time},[],undefined,()=>0,()=>{executions++;return true;});
 run(1,0);engine.updateRules([{...rule}]);run(1,20);run(2,1);assert.equal(executions,1);run(3,10);engine.updateRules([{...rule}]);run(4,25);assert.equal(executions,2);
});

test('inspecting seeded RNG does not consume a roll',()=>{
 const a=seededRandom(19),b=seededRandom(19);a();b();const state=a.getState();assert.equal(a.getState(),state);assert.equal(a(),b());
});

test('updating rune definitions retains serial recovery and conversion queues',()=>{
 const definitions={blood:{rune:true,recharge:10},death:{rune:true,recharge:10}};
 const recovery=createResourceRecovery(definitions);recovery.consume([{resourceId:'blood',amount:2}],0);recovery.convert('blood','death',1);
 const before=structuredClone(recovery.details());recovery.updateDefinitions({...definitions,blood:{rune:true,recharge:20}});assert.deepEqual(recovery.details(),before);
 const restored=[];recovery.tick(10,id=>{restored.push(id);return true;});assert.deepEqual(restored,['death']);assert.deepEqual(recovery.details().convertedReady,{death:['blood']});
 recovery.consume([{resourceId:'blood',amount:1}],10);assert.deepEqual(recovery.snapshot(),{blood:[20,40]});
});

test('build edits preserve an already consumed RNG stream rather than restarting its seed',()=>{
 const doc=fixture();doc.abilities[0].cast=0;doc.abilities[0].cooldown=0;doc.abilities[0].combatEffects[0].canCrit=true;
 const rt=make(doc),control=make(doc);rt.cast('bolt');control.cast('bolt');const consumed=rt.inspectSession().rng;assert.notEqual(consumed,19);
 doc.abilities[0].name='Renamed';rt.updateBuild(compile(doc));assert.equal(rt.inspectSession().rng,consumed);rt.cast('bolt');control.cast('bolt');assert.equal(rt.inspectSession().rng,control.inspectSession().rng);assert.deepEqual(damage(rt).map(e=>e[1]),damage(control).map(e=>e[1]));
});
