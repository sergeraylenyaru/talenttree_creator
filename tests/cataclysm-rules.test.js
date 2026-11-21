import {configureCataclysmClass} from '../static/combat/class-resources.js';
import {createCombatClock} from '../static/combat/combat-clock.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {blank,normalize} from '../static/engine.js';
import {combatClasses,combatRuleValues} from '../static/combat/rulesets.js';
import {rollAttackOutcome} from '../static/combat/calculation-engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';


function document(classId='mage') {
  const doc=blank();
  doc.rpg={version:1,level:85,attributes:{strength:100,agility:100,intellect:100,stamina:100},
    combatRules:{version:'cataclysm-4.3.4',classId,targetLevel:88}};
  doc.abilities=[{id:'bolt',name:'Bolt',icon:'forge-ember',description:'Test spell',learningMode:'base',kind:'active',
    cast:0,cooldown:0,range:30,resourceCosts:[],presentation:{delivery:'ranged',targeting:'dummy',projectile:'straight'},
    combatEffects:[{id:'damage',type:'damage',trigger:'onHit',school:'fire',baseAmount:150,scalingStat:'none',coefficient:0,canCrit:false}]}];
  return doc;
}

test('all ten classes select a versioned profile without altering old documents',()=>{
  const legacy=blank();
  const before=structuredClone(legacy);
  assert.equal(compileCombatBuild(legacy).profile?.combatRules,undefined);
  assert.deepEqual(legacy,before);
  for(const classId of combatClasses){
    const doc=document(classId);
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(doc))),doc);
    const sheet=createCombatRuntime(compileCombatBuild(doc)).sheet();
    assert.equal(sheet.combatRules.classId,classId);
    assert.equal(sheet.combatRules.armorConstant,26070);
    assert.equal(sheet.combatRules.resistanceConstant,425);
    assert.equal(sheet.combatRules.approximateRatings,false);
    assert.equal(sheet.source.attackPower,['warrior','paladin','hunter','rogue','shaman','druid','deathknight'].includes(classId)?200:0);
    assert.equal(sheet.source.spellPower,90);
  }
  const rules=combatRuleValues({level:60,combatRules:{version:'cataclysm-4.3.4',classId:'mage'}},{});
  assert.equal(rules.approximateRatings,true);
});

test('a confirmed projectile impact rolls the combat table once and records a miss without damage',()=>{
  const doc=document();
  const runtime=createCombatRuntime(compileCombatBuild(doc),{random:()=>0});
  let impact;
  runtime.cast('bolt',()=>({projectile:true,validate(){},launch(_,resolve){impact=resolve;}}));
  assert.equal(runtime.state.dummy.health,runtime.state.dummy.maxHealth);
  impact('hit');
  impact('hit');
  assert.equal(runtime.state.dummy.health,runtime.state.dummy.maxHealth);
  assert.equal(runtime.state.combatLog.filter(event=>event.type==='miss').length,1);
  assert.equal(runtime.state.combatLog.filter(event=>event.type==='damage').length,0);
});

test('spell hit, penetration and primary scaling affect the existing engine',()=>{
  const doc=document();
  doc.rpg.attributes.spellHitRating=102.446*17;
  doc.rpg.attributes.spellPenetration=200;
  const build=compileCombatBuild(doc);
  const runtime=createCombatRuntime(build,{random:()=>0,dummy:{resistances:{fire:200}}});
  let impact;
  runtime.cast('bolt',()=>({projectile:true,validate(){},launch(_,resolve){impact=resolve;}}));
  impact('hit');
  assert.equal(runtime.state.dummy.health,runtime.state.dummy.maxHealth-150);
  const event=runtime.state.combatLog.find(event=>event.type==='damage');
  assert.equal(event.outcome,'hit');
  assert.equal(event.source,'player');
  assert.equal(event.target,'dummy');
  assert.equal(new Set(runtime.state.combatLog.map(event=>event.id)).size,runtime.state.combatLog.length);
});

test('one ordered table selects avoidance, glancing, block and hit deterministically',()=>{
  const table={miss:.1,dodge:.1,parry:.1,glancing:.1,block:.1};
  assert.deepEqual([.05,.15,.25,.35,.45,.8].map(value=>rollAttackOutcome(table,value)),
    ['miss','dodge','parry','glancing','block','hit']);
});

test('the combat clock changes rate without jumping and rebases around pause and reset',()=>{
  const clock=createCombatClock(1000);
  assert.equal(clock.time(2000),1);
  clock.setRate(.5,2000,1);
  assert.equal(clock.time(4000),2);
  clock.rebase(5000,2);
  assert.equal(clock.time(7000),3);
  clock.setRate(4,7000,3);
  assert.equal(clock.time(7500),5);
  assert.throws(()=>clock.setRate(-1,7500,5),RangeError);
});

test('incoming dodge, parry and block use the same table and do not spend a shield on avoidance',()=>{
  for(const [stat,outcome,damage] of [['dodgeChance','dodge',0],['parryChance','parry',0],['blockChance','hit',140]]){
    const doc=document('warrior');
    doc.rpg.attributes[stat]=100;
    doc.rpg.incoming={school:'physical',amount:200};
    const runtime=createCombatRuntime(compileCombatBuild(doc),{random:()=>0});
    const before=runtime.state.player.health;
    assert.equal(runtime.incoming(),true);
    assert.equal(before-runtime.state.player.health,damage);
    const event=runtime.state.combatLog.at(-1);
    if(outcome==='hit')assert.equal(event.blocked,60);
    else assert.equal(event.type,outcome);
    assert.equal(event.source,'dummy');
    assert.equal(event.target,'player');
  }
});


test('manual spell queue waits until the cast finishes and consumes each resource cost once',()=>{
  const doc=document();
  doc.rpg.attributes.spellHitRating=10000;
  doc.abilities[0].cast=2;
  doc.abilities[0].resourceCosts=[{resourceId:'legacy:0',amount:20,unit:'points'}];
  doc.abilities.push({...structuredClone(doc.abilities[0]),id:'second',cast:0});
  const runtime=createCombatRuntime(compileCombatBuild(doc),{random:()=>.99});
  const resource=runtime.state.player.resources['legacy:0'].current;
  runtime.cast('bolt');
  runtime.advance(1.8);
  assert.deepEqual(runtime.cast('second'),{ok:true,queued:true});
  assert.equal(runtime.state.player.resources['legacy:0'].current,resource);
  runtime.advance(.2);
  assert.equal(runtime.state.player.resources['legacy:0'].current,resource-40);
  assert.equal(runtime.state.statistics.totalDamage,300);
  assert.equal(runtime.state.combatLog.filter(event=>event.type==='resourceSpent').length,2);
  assert.equal(runtime.state.queuedAbilityId,undefined);
});

test('cancelling a queued cast prevents later automatic execution',()=>{
  const doc=document();
  const runtime=createCombatRuntime(compileCombatBuild(doc),{random:()=>.99});
  runtime.cast('bolt');
  runtime.advance(1.2);
  assert.equal(runtime.cast('bolt').queued,true);
  const count=runtime.state.statistics.casts;
  runtime.cancel();
  runtime.advance(5);
  assert.equal(runtime.state.statistics.casts,count);
});

test('controlled incoming damage pushes a Cata cast back at most twice and cancellation remains free',()=>{
  const doc=document();
  doc.rpg.incoming={school:'physical',amount:10};
  doc.abilities[0].cast=2;
  doc.abilities[0].resourceCosts=[{resourceId:'legacy:0',amount:20,unit:'points'}];
  const runtime=createCombatRuntime(compileCombatBuild(doc),{random:()=>.99});
  const current=runtime.state.player.resources['legacy:0'].current;
  runtime.cast('bolt');
  runtime.advance(.25);
  runtime.incoming();
  runtime.incoming();
  runtime.incoming();
  assert.equal(runtime.state.activeCast.end,3);
  assert.equal(runtime.state.combatLog.filter(event=>event.type==='castPushback').length,2);
  runtime.cancel();
  runtime.advance(5);
  assert.equal(runtime.state.statistics.totalDamage,0);
  assert.equal(runtime.state.player.resources['legacy:0'].current,current);
});

test('all ten class resource profiles preserve authored abilities and support save round trips',()=>{
  for(const key of combatClasses){
    const original=document(key);
    const next=configureCataclysmClass(original,key);
    assert.deepEqual(next.abilities,original.abilities);
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(next))),next);
    const rt=createCombatRuntime(compileCombatBuild(next));
    assert.ok(Object.keys(rt.state.player.resources).length>=1);
    if(key==='deathknight')assert.equal(Object.values(next.rpg.resources).filter(rule=>rule.rune).length,3);
    if(key==='shaman')assert.ok(next.character.resources.some(pool=>pool.id==='cata:maelstrom'));
    if(key==='priest')assert.ok(next.character.resources.some(pool=>pool.id==='cata:orbs'));
  }
});

test('Cataclysm haste respects the one-second GCD floor and a talent can make a cast truly instant',()=>{
  const doc=document();doc.rpg.attributes={haste:500,spellHitRating:10000};doc.rpg.hasteUses=['gcd'];
  const runtime=createCombatRuntime(compileCombatBuild(doc),{random:()=>.99});
  runtime.cast('bolt');assert.equal(runtime.state.globalCooldownUntil,1);
  doc.abilities[0].cast=2;
  doc.abilities.push({...structuredClone(doc.abilities[0]),id:'passive',kind:'passive',combatEffects:[]});
  doc.rpg.bonuses=[{id:'instant',owner:{kind:'passive',id:'passive'},spell:'bolt',stat:'castTime',amount:-100}];
  const instant=createCombatRuntime(compileCombatBuild(doc),{random:()=>.99});
  instant.cast('bolt');assert.equal(instant.state.activeCast,null);assert.equal(instant.state.statistics.casts,1);
});

test('bleeds bypass armor while physical attacks mitigate, and final caps apply after multipliers',()=>{
  const doc=document();doc.rpg.combatRules.position='behind';doc.rpg.attributes.hitRating=10000;doc.rpg.attributes.expertiseRating=10000;
  const base={...doc.abilities[0],presentation:{delivery:'melee',targeting:'dummy',projectile:'none'}};
  doc.abilities=[{...base,id:'physical',combatEffects:[{...base.combatEffects[0],school:'physical',baseAmount:100}]},
    {...base,id:'bleed',combatEffects:[{...base.combatEffects[0],school:'physical',baseAmount:100,damageKind:'bleed'}]},
    {...base,id:'cap',combatEffects:[{...base.combatEffects[0],baseAmount:1000,cap:75}]}];
  const rt=createCombatRuntime(compileCombatBuild(normalize(doc)),{globalCooldown:0,random:()=>.99,dummy:{armor:26070}});
  rt.cast('physical');rt.cast('bleed');rt.cast('cap');
  assert.deepEqual(rt.state.combatLog.filter(event=>event.type==='damage').map(event=>event.amount),[50,100,75]);
});

test('fresh death knights have six typed runes and an explicit level while legacy aggregate pools remain intact',()=>{
  const doc=blank();delete doc.character;delete doc.rpg;
  const fresh=configureCataclysmClass(doc,'deathknight');
  assert.equal(fresh.rpg.level,85);
  assert.equal(fresh.character.resources.some(resource=>resource.id==='cata:runes'),false);
  assert.equal(fresh.character.resources.filter(resource=>fresh.rpg.resources[resource.id]?.rune).reduce((sum,resource)=>sum+resource.max,0),6);
  doc.character=structuredClone(fresh.character);
  doc.character.resources.push({id:'cata:runes',name:'Legacy runes',max:6,current:4,unit:'count',display:'icons',shape:'diamond',color:'#ffffff'});
  const legacy=configureCataclysmClass(doc,'deathknight');
  assert.equal(legacy.character.resources.find(resource=>resource.id==='cata:runes').current,4);
});

test('integer damage never exceeds a fractional final cap',()=>{
  const doc=document();doc.rpg.attributes.spellHitRating=10000;doc.abilities[0].combatEffects[0].cap=75.9;
  const rt=createCombatRuntime(compileCombatBuild(doc),{random:()=>.99});rt.cast('bolt');
  assert.equal(rt.state.combatLog.find(event=>event.type==='damage').amount,75);
});
