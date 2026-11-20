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
