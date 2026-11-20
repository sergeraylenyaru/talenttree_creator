import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {normalize} from '../static/engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';
import {addStatus} from '../static/combat/active-effects.js';
import {deriveCharacterStats,weaponTiming} from '../static/combat/character-stats.js';
import {conditionMatches,createProcEngine} from '../static/combat/proc-engine.js';
import {compareReports,reportCsv} from '../static/combat/session-report.js';
import {itemEligibility,validateItem,removeRpgReferences} from '../static/combat/rpg-profile.js';

const item={id:'blade',name:'Test blade',type:'sword1',slot:'mainHand',icon:'forge-steel',quality:'rare',level:20,
  armor:40,minDamage:100,maxDamage:140,speed:2,stats:{strength:5,critChance:.25}};
const physical={id:'weaponHit',type:'damage',trigger:'onHit',school:'physical',baseAmount:10,weaponCoefficient:1,
  scalingStat:'attackPower',coefficient:.5,canCrit:true};
const status={id:'focus',type:'status',trigger:'onCast',target:'player',name:'Focus',stat:'maxHealth',amount:50,duration:2};
const shield={id:'ward',type:'shield',trigger:'onCast',name:'Ward',amount:60,coefficient:1,priority:20,fraction:1,duration:3};

function document(){
  const doc=JSON.parse(fs.readFileSync(new URL('./fixtures/training-grounds.json',import.meta.url)));
  Object.assign(doc.abilities[0],{cooldown:0,combatEffects:[physical],resourceCosts:[{resourceId:'mana',amount:10,unit:'percent'}]});
  Object.assign(doc.abilities[1],{cast:0,cooldown:0,resourceCosts:[],combatEffects:[]});
  doc.rpg={version:1,items:[structuredClone(item)],equipped:{mainHand:'blade'},attributes:{strength:20,intellect:10,stamina:5},
    formulas:[{from:'strength',to:'attackPower',factor:2},{from:'intellect',to:'spellPower',factor:3},
      {from:'stamina',to:'maxHealth',factor:10},{from:'intellect',to:'resource:mana',factor:2}],
    hasteUses:['swing'],resources:{mana:{onHit:2,onCrit:3,regen:1,decay:0}},incoming:{school:'fire',amount:200},
    bonuses:[{id:'strength',owner:{kind:'talent',id:'fire-talent'},stat:'strength',amount:5}],
    builds:[{id:'saved',name:'Saved',talents:{'fire-talent':1},equipped:{mainHand:'blade'}}]};
  return doc;
}
function runtime(doc,settings={}) {
  return createCombatRuntime(compileCombatBuild(doc,settings),settings);
}

test('class formulas combine talents and gear, and Haste applies to selected systems',()=>{
  const doc=document();
  doc.rpg.attributes.haste=25;
  const build=compileCombatBuild(normalize(doc));
  const sheet=deriveCharacterStats(build);
  assert.equal(sheet.primary.strength,30);
  assert.equal(sheet.source.attackPower,60);
  assert.equal(sheet.source.spellPower,30);
  assert.equal(sheet.source.critChance,.35);
  assert.equal(sheet.armor,40);
  assert.equal(sheet.maxHealth,1050);
  assert.equal(sheet.resources.find(resource=>resource.id==='mana').max,120);
  assert.equal(sheet.castSpeed,1);
  assert.deepEqual(weaponTiming(sheet,{swingSeconds:3,damage:400}),{swingSeconds:1.6,minDamage:100,maxDamage:140,
    type:'sword1',ranged:false,offHand:undefined});
  delete doc.rpg.equipped.mainHand;
  assert.equal(runtime(doc).sheet().source.attackPower,50);
  doc.build={};
  assert.equal(runtime(doc).sheet().source.attackPower,40);
});

test('profile rejects invalid gear, percentages and references and removes deleted item references',()=>{
  const doc=document();
  const offHand={...item,id:'off',type:'dagger',slot:'offHand'};
  assert.match(itemEligibility(offHand,'offHand',doc.rpg),/Dual wield/);
  doc.rpg.restrictions={dualWield:true};
  assert.equal(itemEligibility(offHand,'offHand',doc.rpg), '');
  assert.match(itemEligibility(offHand,'offHand',doc.rpg,{mainHand:{type:'sword2'}}), /two-handed/);
  assert.throws(()=>validateItem({...item,speed:NaN}),/speed/);
  assert.throws(()=>validateItem({...item,stats:{critChance:1.01}}),/statistic/i);
  assert.throws(()=>normalize({...doc,rpg:{...doc.rpg,equipped:{mainHand:'unknown'}}}),/missing/);
  removeRpgReferences(doc.rpg,'item','blade');
  assert.deepEqual(doc.rpg.equipped,{});
  assert.deepEqual(doc.rpg.builds[0].equipped,{});
});

test('defensive buffs change live maximums and shields resolve in priority order before health loss',()=>{
  const doc=document();
  doc.rpg.attributes.fireResistance=1000;
  doc.abilities[1].combatEffects=[status,{...status,id:'mana',stat:'maxResource'},shield,
    {...shield,id:'veil',amount:0,coefficient:0,priority:1,fraction:.2}];
  const rt=runtime(doc,{globalCooldown:0});
  assert.equal(rt.cast('heal').ok,true);
  assert.equal(rt.state.player.maxHealth,1575);
  assert.equal(rt.state.player.resources.mana.max,180);
  assert.equal(rt.incoming(),true);
  assert.deepEqual(rt.report().timeline.filter(e=>e.type==='absorbed').map(e=>e.amount),[90,14]);
  const incoming=rt.report().timeline.find(e=>e.type==='incomingDamage');
  assert.equal(incoming.mitigated,40);
  assert.equal(incoming.absorbed,104);
  assert.equal(incoming.amount,56);
  assert.equal(rt.state.player.health,994);
  rt.advance(2);
  assert.equal(rt.state.player.maxHealth,1050);
  assert.equal(rt.state.player.resources.mana.max,120);
  rt.advance(2);
  assert.equal(rt.statuses.length,0);
  rt.reset();
  assert.equal(rt.state.player.health,1050);
  assert.equal(rt.report().timeline.length,0);
});

test('weapon damage, critical resource gain, periodic snapshots and analytics share one timeline',()=>{
  const doc=document();
  doc.rpg.attributes.critChance=.75;
  const damage={...physical,id:'burn',school:'fire',baseAmount:10,coefficient:1,scalingStat:'spellPower',canCrit:false,
    weaponCoefficient:0,interval:1,duration:2,snapshot:true};
  doc.abilities[0].combatEffects.push(damage);
  doc.abilities[1].combatEffects=[{...status,stat:'spellPower',amount:100,duration:1},
    {id:'restore',type:'healing',trigger:'onCast',baseAmount:10,scalingStat:'none',coefficient:0,canCrit:false,interval:1,duration:2}];
  const rt=runtime(doc,{seed:13,globalCooldown:0,dummy:{armor:1000,resistances:{fire:1000}}});
  rt.incoming();
  rt.cast('heal');
  rt.cast('flame');
  rt.advance(2);
  const report=rt.report();
  const [strike,...ticks]=report.timeline.filter(e=>e.type==='damage');
  assert.deepEqual([strike.original,strike.bonus,strike.critical,strike.mitigated,strike.amount],[10,150,160,64,256]);
  assert.deepEqual(ticks.map(e=>e.amount),[56,56]);
  assert.equal(report.metrics.damage,368);
  assert.equal(report.metrics.dps,184);
  assert.equal(report.metrics.effective,20);
  assert.equal(report.metrics.hps,10);
  assert.equal(report.metrics.spent,12);
  assert.equal(report.metrics.gained,7);
  assert.equal(report.schools.fire,112);
  assert.equal(report.effects.find(e=>e.name==='Flame').uptime,2);
  assert.match(reportCsv(report),/class,seed,build,conditions/);
  assert.equal(JSON.parse(JSON.stringify(report)).build.equipment.mainHand.name,'Test blade');
  assert.equal(compareReports(report,{...report,seed:14}).comparable,false);
  assert.equal(compareReports(report,report).comparable,true);
});

test('bounded status stacking and independent instances use the simulation clock',()=>{
  const ability={id:'ward'};
  let effects=addStatus([],ability,{...status,interval:.5,stacks:2,refresh:'extend'},0);
  effects=addStatus(effects,ability,effects[0].effect,.4);
  effects=addStatus(effects,ability,effects[0].effect,1);
  assert.deepEqual([effects[0].stacks,effects[0].nextTick,effects[0].expires],[2,.5,6]);
  const independent={...status,stacks:2,refresh:'independent'};
  effects=addStatus([],ability,independent,0);
  effects=addStatus(effects,ability,independent,1);
  effects=addStatus(effects,ability,independent,1.5);
  assert.deepEqual(effects.map(effect=>effect.expires),[3,3.5]);
  assert.deepEqual(effects.map(effect=>effect.stacks),[1,1]);
});

test('conditional procs respect chance, cadence, internal cooldown and execution depth',()=>{
  const rules=[{id:'spark',event:'critical',chance:1,cooldown:3,every:2,condition:{type:'school',value:'fire'}},
    {id:'never',event:'critical',chance:0,cooldown:0}];
  const engine=createProcEngine(rules,()=>.8);
  const activated=[];
  function trigger(id,time,patch={}){
    engine.dispatch({id,type:'damage',isCritical:true,school:'fire',...patch},{combatTime:time},[],null,
      ()=>0,(rule,event)=>{activated.push([rule.id,event.id]);return true;});
  }
  trigger(1,0);trigger(1,0);trigger(2,0);trigger(3,0,{depth:1});trigger(4,1);trigger(5,1);
  trigger(6,4);trigger(7,4);
  assert.deepEqual(activated,[['spark',2],['spark',7]]);
  assert.equal(conditionMatches({type:'resourceAbove',resource:'mana',value:40},{},{player:{resources:{mana:{current:41}}}}),true);
  assert.equal(conditionMatches({type:'dummyStatus',value:'focus'},{},{},[{target:'dummy',effect:status,ability:{id:'flame'}}]),true);
});

test('passive proc payload uses the existing effect, grants resource once and cannot recurse',()=>{
  const doc=document();
  doc.abilities[3].combatEffects=[{id:'bonus',type:'resource',trigger:'onCast',resourceId:'mana',amount:10,unit:'points'}];
  doc.rpg.procs=[
    {id:'gain',owner:{kind:'passive',id:'passive'},name:'Gain',event:'damage',chance:1,cooldown:10,spell:'passive',effect:'bonus'},
    {id:'loop',owner:{kind:'passive',id:'passive'},name:'Loop',event:'procTriggered',chance:1,cooldown:0,spell:'passive',effect:'bonus'}
  ];
  assert.throws(()=>runtime(doc));
  doc.rpg.procs[1].event='resourceGained';
  doc.rpg.resources.mana.onHit=0;
  doc.rpg.resources.mana.onCrit=0;
  const rt=runtime(doc,{globalCooldown:0,seed:123});
  rt.cast('flame');
  rt.cast('flame');
  assert.equal(rt.state.player.resources.mana.current,66);
  assert.deepEqual(rt.report().procs.map(row=>[row.id,row.count]),[['gain',1]]);
});

test('player resource draining clamps the pool and reports the real loss',()=>{
  const doc=document();
  doc.abilities[1].combatEffects=[{id:'drain',type:'resource',trigger:'onCast',resourceId:'mana',amount:200,unit:'points',direction:'drain'}];
  const rt=runtime(doc,{globalCooldown:0});
  assert.equal(rt.cast('heal').ok,true);
  assert.equal(rt.state.player.resources.mana.current,0);
  assert.equal(rt.report().timeline.find(event=>event.type==='resourceLost').amount,80);
  assert.equal(rt.availability('flame').reason,'insufficient');
});

test('autoattack can land during the GCD without changing it or paying the active ability cost',()=>{
  const doc=document();
  const rt=runtime(doc,{globalCooldown:1.5,seed:13});
  rt.cast('flame');
  const before=rt.state.globalCooldownUntil;
  const auto={id:'auto',name:'Autoattack',isAuto:true,combatEffects:[{...physical,weaponCoefficient:0,
    canCrit:false,baseAmount:100,coefficient:0}]};
  rt.autoImpact(auto,{},rt.state.combatTime);
  assert.equal(rt.state.globalCooldownUntil,before);
  assert.equal(rt.report().metrics.spent,12);
  assert.equal(rt.report().metrics.auto,100);
  assert.equal(rt.availability('heal').reason,'gcd');
});

test('a real vulnerability status affects the next hit, expires and can refresh without stacking',()=>{
  const doc=document();
  doc.abilities[0].combatEffects=[
    {...physical,school:'fire',baseAmount:100,scalingStat:'none',coefficient:0,weaponCoefficient:0,canCrit:false},
    {...status,target:'dummy',stat:'magicalTaken',duration:2,stacks:3,refresh:'refreshOnly'}];
  doc.abilities[0].resourceCosts=[];
  const rt=runtime(doc,{globalCooldown:0});
  rt.cast('flame');
  rt.advance(1);
  rt.cast('flame');
  assert.equal(rt.statuses[0].stacks,1);
  assert.equal(rt.statuses[0].expires,3);
  rt.advance(2);
  assert.equal(rt.statuses.length,0);
  rt.cast('flame');
  assert.deepEqual(rt.report().timeline.filter(event=>event.type==='damage').map(event=>event.amount),[100,150,100]);
});

test('a school-specific one-use buff survives unrelated attacks and expires on its direct hit',()=>{
  const doc=document();
  const fire={...physical,school:'fire',id:'fire',baseAmount:100,scalingStat:'none',coefficient:0,weaponCoefficient:0,canCrit:false};
  const normal={...fire,school:'physical',id:'normal'};
  doc.abilities[0].combatEffects=[normal,fire];
  doc.abilities[0].resourceCosts=[];
  doc.abilities[1].combatEffects=[{...status,id:'cinder',stat:'damageDone',school:'fire',consumeOnHit:true,amount:50}];
  const rt=runtime(doc,{globalCooldown:0});
  rt.cast('heal');
  rt.cast('flame');
  rt.cast('flame');
  assert.deepEqual(rt.report().timeline.filter(e=>e.type==='damage').map(e=>e.amount),[100,150,100,100]);
  assert.equal(rt.statuses.length,0);
  assert.equal(rt.report().timeline.filter(e=>e.type==='statusExpired').length,1);
});
