import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutoAttack} from '../static/combat/auto-attack.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {blank,normalize} from '../static/engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
const damage={id:'hit',type:'damage',trigger:'onHit',school:'fire',baseAmount:10,scalingStat:'none',coefficient:0,canCrit:false};
const skill=(id,extra={})=>({id,name:id,description:'Clock test',kind:'active',learningMode:'base',icon:'forge-fire',cast:0,cooldown:0,range:30,resourceCosts:[],combatEffects:[damage],workshop:{version:1,noGcd:true},...extra});
function build(abilities){const doc=blank();doc.abilities=abilities;doc.rpg={version:1,level:85,attributes:{spellHitRating:10000},combatRules:{version:'cataclysm-4.3.4',classId:'mage',targetLevel:85}};return compileCombatBuild(normalize(doc));}

test('both swing deadlines share the runtime clock independently of render cadence',()=>{
  function run(frames){
    const rt=createCombatRuntime(build([]),{seed:42});const strikes=[];
    for(const [hand,interval] of [['main',2],['off',1.4]]){
      const auto=createAutoAttack({swingSeconds:interval,windupSeconds:.25});
      const delivery={validate:()=>undefined,autoPose(){},autoContact:()=>true};
      auto.start(()=>{},0);
      rt.attachTimeline(hand,{next:now=>auto.nextAt(now),tick:now=>auto.update(now,delivery,()=>{},(_delivery,start,hit)=>strikes.push([hand,Number(hit.toFixed(8)),Number(rt.state.combatTime.toFixed(8))]))});
    }
    for(const delta of frames)rt.advance(delta);
    return strikes;
  }
  const slow=run([10]);const fast=run(Array(100).fill(.1));assert.deepEqual(fast,slow);
  assert.deepEqual(slow.filter(([hand])=>hand==='main').map(([,time])=>time),[0,2,4,6,8,10]);
  assert.deepEqual(slow.filter(([hand])=>hand==='off').map(([,time])=>time),[0,1.4,2.8,4.2,5.6,7,8.4,9.8]);
  for(const [,scheduled,actual] of slow)assert.equal(actual,scheduled);
});

test('late updates catch up swings but waiting out of range never accumulates attacks',()=>{
  const auto=createAutoAttack({swingSeconds:2,windupSeconds:.25});let reason;const hits=[];
  const delivery={validate:()=>reason,autoPose(){},autoContact:()=>true};auto.start(()=>{},0);
  const update=now=>auto.update(now,delivery,()=>{},(_delivery,start,hit)=>{assert.ok(start>=0);hits.push(hit);});
  update(0);update(6);assert.deepEqual(hits,[0,2,4,6]);
  reason='outOfRange';update(7);update(20);reason=undefined;update(21);assert.deepEqual(hits,[0,2,4,6,21]);
});

test('swing pause preserves progress and reset restarts a full interval',()=>{
  for(const [reset,next] of [[false,6],[true,7]]){
    const auto=createAutoAttack({swingSeconds:2,windupSeconds:.25});const delivery={validate:()=>undefined,autoPose(){},autoContact:()=>true};
    auto.start(()=>{},0);auto.update(0,delivery,()=>{},()=>{});auto.suspend(1,true,reset);assert.equal(auto.nextAt(4),Infinity);
    auto.suspend(5,false);assert.equal(auto.nextAt(5),next-.25);
  }
});

test('shared cooldown blocks another ability and resets only when explicitly requested',()=>{
  const shared={version:1,noGcd:true,cooldownGroup:'test',groupCooldown:8};
  const reset=skill('reset',{combatEffects:[{id:'reset',type:'cooldown',trigger:'onCast',abilityId:'first',seconds:0,reset:true,includeGroup:true}]});
  const rt=createCombatRuntime(build([skill('first',{workshop:shared}),skill('second',{workshop:shared}),reset]),{seed:1});
  assert.equal(rt.cast('first').ok,true);assert.equal(rt.cast('second').reason,'cooldownGroup');
  rt.advance(2);assert.equal(rt.availability('second').remaining,6);rt.cast('reset');assert.equal(rt.cast('second').ok,true);
});

test('Cataclysm channel begins GCD before its first tick and never pays twice',()=>{
  const ability=skill('channel',{presentation:{delivery:'ranged',targeting:'dummy',projectile:'none',channelDuration:4},resourceCosts:[{resourceId:'legacy:0',amount:10,unit:'points'}],workshop:{version:1,tickInterval:1}});
  const rt=createCombatRuntime(build([ability]),{seed:1});assert.equal(rt.cast('channel').ok,true);
  assert.equal(rt.state.globalCooldownUntil,1.5);assert.equal(rt.state.player.resources['legacy:0'].current,90);rt.advance(4);
  assert.equal(rt.state.player.resources['legacy:0'].current,90);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='resourceSpent').length,1);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='channelTick').length,4);assert.equal(rt.state.activeCast,null);
});

test('a cancelled Cataclysm channel keeps its single upfront payment but creates no late ticks',()=>{
  const ability=skill('channel',{presentation:{delivery:'ranged',targeting:'dummy',projectile:'none',channelDuration:4},resourceCosts:[{resourceId:'legacy:0',amount:10,unit:'points'}],workshop:{version:1,tickInterval:1}});
  const rt=createCombatRuntime(build([ability]),{seed:1});rt.cast('channel');rt.advance(.5);rt.cancel();rt.advance(10);
  assert.equal(rt.state.player.resources['legacy:0'].current,90);assert.equal(rt.state.statistics.totalDamage,0);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='resourceSpent').length,1);
});

// Synthetic geometry verifies scheduling only; GLB coverage is in the browser suite.
test('projectile contact is resolved at the same combat-clock boundary with slow and fast frames',async()=>{
  const {createSpatialCombat}=await import('../static/world/combat/spatial-combat.js');
  function simulate(frames){
    const rt=createCombatRuntime(build([skill('bolt',{presentation:{delivery:'ranged',targeting:'dummy',projectile:'homing',projectileSpeed:7},resourceCosts:[{resourceId:'legacy:0',amount:10,unit:'points'}]})]),{seed:13});
    const target={selected:()=>true,read:()=>({position:{x:0,y:1.25,z:-7},radius:.7,alive:rt.state.dummy.health>0})};
    const spatial=createSpatialCombat({player:()=>({x:0,y:0,z:0}),target:()=>target,obstacles:[],face(){},animate(){},visuals:{spawn:()=>({}),move(){},remove(){},impact(){}}});
    rt.attachTimeline('spatial',{next:()=>spatial.nextEvent(),tick:now=>spatial.update(now),cancel:()=>spatial.clear()});
    rt.cast('bolt',spatial.delivery);for(const frame of frames)rt.advance(frame);
    return rt.report().timeline.filter(e=>['damage','resourceSpent','projectileHit','projectileMissed'].includes(e.type));
  }
  const slow=simulate([4]),fast=simulate(Array(240).fill(1/60));assert.deepEqual(slow,fast);
  assert.equal(slow.filter(e=>e.type==='damage').length,1);assert.equal(slow.filter(e=>e.type==='resourceSpent').length,1);
});

test('haste during a suspended swing retimes the preserved progress',()=>{
  const auto=createAutoAttack({swingSeconds:2,windupSeconds:.25}),delivery={validate(){},autoPose(){},autoContact:()=>true};
  auto.start(()=>{},0);auto.update(0,delivery,()=>{},()=>{});auto.suspend(1,true);auto.nextAt(2,1);auto.suspend(5,false);assert.equal(auto.nextAt(5),5.25);
});

test('shared-group completion is distinct from the ability cooldown for proc and analytics consumers',()=>{
  const rt=createCombatRuntime(build([skill('strike',{cooldown:8,workshop:{version:1,noGcd:true,cooldownGroup:'group',groupCooldown:8}})]),{seed:1});
  rt.cast('strike');rt.advance(8);assert.equal(rt.state.combatLog.filter(e=>e.type==='cooldownCompleted').length,1);
  assert.equal(rt.state.combatLog.filter(e=>e.type==='cooldownGroupCompleted').length,1);
});
