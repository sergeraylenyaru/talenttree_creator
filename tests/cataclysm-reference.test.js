import test from 'node:test';
import assert from 'node:assert/strict';
import {attackTable,resolveAttackTable,targetSide} from '../static/combat/attack-rules.js';
import {combatRuleValues} from '../static/combat/rulesets.js';
import {blank,normalize} from '../static/engine.js';
import {compileCombatBuild} from '../static/combat/build-compiler.js';
import {createCombatRuntime} from '../static/combat/combat-runtime.js';

const hit={id:'hit',type:'damage',trigger:'onHit',school:'physical',baseAmount:100,scalingStat:'none',coefficient:0,canCrit:true};
const skill=(id,effects=[hit],workshop={})=>({id,name:id,description:'Reference fixture',icon:'forge-steel',kind:'active',learningMode:'base',
  cast:0,cooldown:0,range:30,resourceCosts:[],combatEffects:effects,workshop:{version:1,...workshop}});
const rules={level:85,targetLevel:88,hit:0,spellHit:0,expertise:0,position:'front'};
// Golden numeric expectations transcribed independently from the cited sources,
// not calculated by calling the production formulas to generate expected values.
test('Cata PvE attack classes use separate sourced miss and avoidance rules',()=>{
  const white=attackTable({ability:{...skill('white'),isAuto:true},rules,crit:.2,dualWield:true});
  assert.ok(Math.abs(white.miss-.27)<1e-12);assert.ok(Math.abs(white.dodge-.065)<1e-12);
  assert.ok(Math.abs(white.parry-.14)<1e-12);assert.equal(white.glancing,.24);assert.ok(Math.abs(white.critical-.152)<1e-12);
  const yellow=attackTable({ability:skill('yellow'),rules,crit:.2});assert.equal(yellow.miss,.08);assert.equal(yellow.glancing,0);
  const ranged=attackTable({ability:skill('shot',[hit],{attackType:'ranged'}),rules,crit:.2});
  assert.equal(ranged.miss,.08);assert.deepEqual([ranged.dodge,ranged.parry,ranged.block,ranged.glancing],[0,0,0,0]);
  const spell=attackTable({ability:skill('spell',[{...hit,school:'fire'}]),rules,crit:.2});
  assert.equal(spell.miss,.17);assert.equal(spell.critical,.2);
  assert.equal(attackTable({ability:skill('spell',[{...hit,school:'fire'}]),rules:{...rules,targetLevel:87}}).miss,.06);
});

test('white critical uses the same ordered roll while special critical is a second roll after success',()=>{
  const ability={...skill('white'),isAuto:true},table=attackTable({ability,rules,crit:.2,dualWield:true});
  let rolls=0;const white=resolveAttackTable(table,()=>{rolls++;return .8;});
  assert.equal(white.outcome,'critical');assert.equal(white.isCritical,true);assert.equal(rolls,1);
  const numbers=[.8,.1];rolls=0;
  const special=resolveAttackTable(attackTable({ability:skill('special'),rules,crit:.2}),()=>{rolls++;return numbers.shift();});
  assert.equal(special.outcome,'hit');assert.equal(special.isCritical,true);assert.equal(rolls,2);
});

test('armor golden values agree with both historical implementations at level boundaries',()=>{
  for(const [level,k] of [[59,5415],[60,5882.5],[80,15232.5],[81,17400],[85,26070]]){
    const result=combatRuleValues({level,combatRules:{version:'cataclysm-4.3.4',classId:'warrior'}},{});
    assert.equal(result.armorConstant,k);
  }
});

test('one missed attack cannot apply its damage, debuff or hit resource effect and pays only once',()=>{
  const doc=blank();doc.rpg={version:1,level:85,attributes:{},combatRules:{version:'cataclysm-4.3.4',classId:'mage',targetLevel:88}};
  doc.abilities=[skill('bolt',[{...hit,school:'fire'},{...hit,id:'second',school:'frost'},
    {id:'weak',type:'status',trigger:'onHit',target:'dummy',name:'Weak',stat:'damageTaken',amount:10,duration:4},
    {id:'gain',type:'resource',trigger:'onHit',resourceId:'legacy:0',unit:'points',amount:50}])];
  doc.abilities[0].resourceCosts=[{resourceId:'legacy:0',amount:10,unit:'points'}];
  let draws=0;const rt=createCombatRuntime(compileCombatBuild(normalize(doc)),{random:()=>{draws++;return 0;}});
  rt.cast('bolt');assert.equal(draws,1);assert.equal(rt.statuses.length,0);assert.equal(rt.state.statistics.totalDamage,0);
  assert.equal(rt.state.player.resources['legacy:0'].current,90);assert.equal(rt.state.combatLog.filter(event=>event.type==='miss').length,1);
});

test('weapon AP uses base speed or explicit normalization and a selected off hand',()=>{
  const doc=blank();doc.rpg={version:1,level:85,attributes:{strength:100,hitRating:10000,expertiseRating:10000},
    combatRules:{version:'cataclysm-4.3.4',classId:'warrior',targetLevel:85,position:'behind'},restrictions:{dualWield:true},
    items:[{id:'main',name:'Main',icon:'forge-steel',level:85,quality:'rare',slot:'mainHand',type:'sword1',minDamage:100,maxDamage:100,speed:3,stats:{}},
      {id:'off',name:'Off',icon:'forge-steel',level:85,quality:'rare',slot:'offHand',type:'dagger',minDamage:40,maxDamage:40,speed:1.4,stats:{}}],equipped:{mainHand:'main',offHand:'off'}};
  const effect={...hit,baseAmount:0,canCrit:false,weaponCoefficient:1};
  doc.abilities=[skill('normal',[effect],{attackType:'melee',weaponHand:'mainHand'}),
    skill('normalized',[effect],{attackType:'melee',weaponHand:'mainHand',normalizedWeapon:true}),skill('off',[effect],{attackType:'melee',weaponHand:'offHand'})];
  const rt=createCombatRuntime(compileCombatBuild(normalize(doc)),{globalCooldown:0,random:()=>.99});
  for(const id of ['normal','normalized','off'])rt.cast(id);
  assert.deepEqual(rt.state.combatLog.filter(event=>event.type==='damage').map(event=>event.amount),[143,134,30]);
});

test('front and behind derive from the target facing and actual relative position',()=>{
  const target={position:{x:0,z:0},facing:0};
  assert.equal(targetSide({x:0,z:3},target),'front');assert.equal(targetSide({x:0,z:-3},target),'behind');
  target.facing=Math.PI/2;assert.equal(targetSide({x:3,z:0},target),'front');assert.equal(targetSide({x:-3,z:0},target),'behind');
});

test('level 85 stamina uses the historical 14 health rule after the first twenty points',()=>{
  const rules=combatRuleValues({level:85,combatRules:{version:'cataclysm-4.3.4',classId:'warrior'}},{stamina:100});
  assert.equal(rules.health,1140);assert.equal(rules.mastery,8);assert.equal(rules.approximatePrimary,true);
});

test('the simulator rounds after block and applies the authored final cap after all reductions',()=>{
  const doc=blank();doc.rpg={version:1,level:85,attributes:{hitRating:10000,expertiseRating:10000},combatRules:{version:'cataclysm-4.3.4',classId:'warrior',targetLevel:85,position:'front'}};
  doc.abilities=[skill('round',[{...hit,baseAmount:50.6,canCrit:false}]),skill('cap',[{...hit,baseAmount:50.6,cap:30,canCrit:false}])];
  const rt=createCombatRuntime(compileCombatBuild(normalize(doc)),{globalCooldown:0,random:()=>.01});rt.cast('round');rt.cast('cap');
  const hits=rt.state.combatLog.filter(e=>e.type==='damage');assert.deepEqual(hits.map(e=>e.amount),[35,30]);assert.equal(hits[1].capped,5);assert.equal(hits[1].blocked,16);
});
