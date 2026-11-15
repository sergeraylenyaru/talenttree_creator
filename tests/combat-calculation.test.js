import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateDamage, calculateHealing, calculateCombatEffect, calculateMitigation, rollCritical} from '../static/combat/calculation-engine.js';
import {validateCombatEffects} from '../static/engine.js';

const damage = (patch={}) => ({id:'hit', type:'damage', trigger:'onHit', school:'physical', baseAmount:100, scalingStat:'none', coefficient:0, canCrit:true, ...patch});
const healing = (patch={}) => ({id:'heal', type:'healing', trigger:'onCast', baseAmount:100, scalingStat:'none', coefficient:0, canCrit:true, ...patch});
const near = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-10, `${actual} != ${expected}`);
function freeze(value) { if (value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('physical base damage', () => assert.equal(calculateDamage(damage()).finalAmount, 100));
test('fire Spell Power scaling and example context', () => {
  const result=calculateDamage(damage({school:'fire',baseAmount:120,scalingStat:'spellPower',coefficient:0.65}), {
    source:{spellPower:200,attackPower:100,critChance:0.25,critMultiplier:2,damageMultiplier:1.1,healingMultiplier:1,schoolDamageMultipliers:{fire:1.2}},
    target:{armor:1000,resistances:{fire:1000,frost:0},damageTakenMultiplier:1,healingTakenMultiplier:1},
    rules:{armorConstant:4000,resistanceConstant:4000,maxDamageReduction:0.75},outcome:{isCritical:false}
  });
  assert.equal(result.scalingAmount,130);assert.equal(result.rawAmount,250);assert.equal(result.finalAmount,264);
});
test('Attack Power scaling', () => assert.equal(calculateDamage(damage({scalingStat:'attackPower',coefficient:0.4}), {source:{attackPower:250,spellPower:999}}).finalAmount,200));
test('none ignores both stats even with a nonzero coefficient', () => assert.equal(calculateDamage(damage({coefficient:1000}), {source:{spellPower:999,attackPower:999}}).scalingAmount,0));
for (const school of ['physical','fire','frost','arcane','nature','shadow','holy']) {
  test(`${school} selects only its own mitigation and school multiplier`, () => {
    const context={source:{schoolDamageMultipliers:{[school]:1.5}},target:{armor:school==='physical'?1000:90000,resistances:{[school]:1000}}};
    assert.equal(calculateDamage(damage({school}),context).finalAmount,120);
  });
}
test('armor mitigation uses a configurable constant', () => {
  const r=calculateMitigation('physical',{armor:1000},{armorConstant:3000});
  assert.equal(r.kind,'armor');assert.equal(r.reduction,0.25);assert.equal(r.multiplier,0.75);
});
test('magic resistance ignores armor and uses resistance constant', () => {
  const r=calculateMitigation('fire',{armor:9000,resistances:{fire:1000,frost:9000}},{resistanceConstant:3000});
  assert.equal(r.kind,'resistance');assert.equal(r.defense,1000);assert.equal(r.reduction,0.25);
});
test('mitigation defaults and zero defense', () => {
  assert.equal(calculateMitigation('fire').reduction,0);assert.equal(calculateMitigation('physical').constant,4000);
});
test('mitigation cap applies equally to armor and resistance', () => {
  assert.equal(calculateDamage(damage(),{target:{armor:36000}}).finalAmount,25);
  assert.equal(calculateDamage(damage({school:'fire'}),{target:{resistances:{fire:36000}}}).finalAmount,25);
  assert.equal(calculateMitigation('physical',{armor:36000},{maxDamageReduction:0.5}).reduction,0.5);
  assert.equal(calculateMitigation('physical',{armor:36000},{maxDamageReduction:0}).reduction,0);
});
test('large finite defenses/constants do not overflow their sum', () => {
  assert.equal(calculateMitigation('physical',{armor:Number.MAX_VALUE},{armorConstant:Number.MAX_VALUE}).reduction,0.5);
});
test('source damage multiplier', () => assert.equal(calculateDamage(damage(),{source:{damageMultiplier:1.25}}).finalAmount,125));
test('school damage multiplier', () => assert.equal(calculateDamage(damage({school:'holy'}),{source:{schoolDamageMultipliers:{holy:1.5,fire:9}}}).finalAmount,150));
test('target damage multiplier', () => assert.equal(calculateDamage(damage(),{target:{damageTakenMultiplier:0.8}}).finalAmount,80));
test('critical damage is explicitly requested; critChance never rolls itself', () => {
  assert.equal(calculateDamage(damage(),{source:{critChance:0,critMultiplier:2},outcome:{isCritical:true}}).finalAmount,200);
  const r=calculateDamage(damage(),{source:{critChance:1,critMultiplier:2}});assert.equal(r.finalAmount,100);assert.equal(r.isCritical,false);
});
for (const factory of [damage,healing]) test(`${factory().type} cannot crit when disabled`, () => {
  const r=calculateCombatEffect(factory({canCrit:false}),{source:{critMultiplier:3},outcome:{isCritical:true}});
  assert.equal(r.finalAmount,100);assert.equal(r.isCritical,false);assert.equal(r.multipliers.critical,1);
});
test('critical healing', () => assert.equal(calculateHealing(healing(),{source:{critMultiplier:1.5},outcome:{isCritical:true}}).finalAmount,150));
test('normal healing and Spell Power scaling ignore armor, resistances and damage multipliers', () => {
  const r=calculateHealing(healing({scalingStat:'spellPower',coefficient:0.5}),{source:{spellPower:200,damageMultiplier:0},target:{armor:1e9,resistances:{holy:1e9},damageTakenMultiplier:0}});
  assert.equal(r.finalAmount,200);assert.equal(r.mitigation.reduction,0);assert.equal(r.mitigation.kind,'none');assert.equal('school' in r,false);
});
test('Attack Power scales healing', () => assert.equal(calculateHealing(healing({scalingStat:'attackPower',coefficient:0.25}),{source:{attackPower:200}}).finalAmount,150));
test('source healing multiplier', () => assert.equal(calculateHealing(healing(),{source:{healingMultiplier:1.3}}).finalAmount,130));
test('target healing multiplier', () => assert.equal(calculateHealing(healing(),{target:{healingTakenMultiplier:0.7}}).finalAmount,70));
test('healing multipliers and critical combine without a missing-health cap', () => assert.equal(calculateHealing(healing({baseAmount:1000}),{source:{healingMultiplier:1.2,critMultiplier:2},target:{healingTakenMultiplier:0.5},outcome:{isCritical:true}}).finalAmount,1200));
test('zero multipliers are valid', () => {
  assert.equal(calculateDamage(damage(),{source:{damageMultiplier:0}}).finalAmount,0);
  assert.equal(calculateHealing(healing(),{target:{healingTakenMultiplier:0}}).finalAmount,0);
});
test('critical chance boundaries and strict less-than comparison', () => {
  assert.equal(rollCritical(0,0),false);assert.equal(rollCritical(1,0),true);assert.equal(rollCritical(1,0.999999),true);
  assert.equal(rollCritical(0.25,0.25),false);assert.equal(rollCritical(0.25,0.249999),true);
});
test('deterministic rolls repeat without internal randomness', () => {
  assert.deepEqual([0,0.25,0.5,0.75].map(v=>rollCritical(0.5,v)),[true,true,false,false]);
  const random = Math.random;
  try {
    Math.random = () => { throw Error('Unexpected internal RNG'); };
    for(let i=0;i<10;i++){
      assert.equal(rollCritical(0.5,0.25),true);
      assert.equal(calculateDamage(damage()).finalAmount,100);
      assert.equal(calculateHealing(healing()).finalAmount,100);
    }
  } finally { Math.random = random; }
  // Runtime is pure; no probabilistic outcome is inferred from critChance.
  assert.equal(calculateCombatEffect(damage(),{source:{critChance:1}}).isCritical,false);
});
test('invalid critical rolls are rejected', () => {
  for(const chance of [-1,1.01,NaN,Infinity,null,'0.5',true])assert.throws(()=>rollCritical(chance,0));
  for(const random of [-0.1,1,NaN,Infinity,null,'0.5',true])assert.throws(()=>rollCritical(0.5,random));
});
test('default context and neutral default critical multiplier', () => {
  const r=calculateDamage(damage(),{});assert.equal(r.finalAmount,100);assert.equal(r.scalingAmount,0);
  assert.deepEqual(r.multipliers,{source:1,school:1,target:1,critical:1,total:1});
  assert.equal(calculateDamage(damage({scalingStat:'spellPower',coefficient:1})).finalAmount,100);
  assert.equal(calculateDamage(damage(),{outcome:{isCritical:true}}).finalAmount,100);
});
test('dispatch and dedicated type guards', () => {
  assert.deepEqual(calculateCombatEffect(damage()),calculateDamage(damage()));
  assert.deepEqual(calculateCombatEffect(healing()),calculateHealing(healing()));
  assert.throws(()=>calculateDamage(healing()));assert.throws(()=>calculateHealing(damage()));
});
test('invalid effects reuse the foundation schema', () => {
  for(const patch of [{id:''},{type:'buff'},{trigger:'onTick'},{school:'chaos'},{scalingStat:'haste'},{baseAmount:-1},{coefficient:1001},{canCrit:'true'},{script:'alert(1)'}]){
    const e=damage(patch);assert.throws(()=>validateCombatEffects({combatEffects:[e]}));assert.throws(()=>calculateCombatEffect(e));
  }
  for(const key of Object.keys(damage())){const e=damage();delete e[key];assert.throws(()=>calculateDamage(e));}
  for(const e of [null,[],1,{},healing({school:'holy'})])assert.throws(()=>calculateCombatEffect(e));
});
for(const key of ['spellPower','attackPower','critChance'])test(`invalid source ${key}`, () => {
  for(const value of [-1,NaN,Infinity,-Infinity,null,'1',true])assert.throws(()=>calculateDamage(damage(),{source:{[key]:value}}));
  if(key==='critChance')assert.throws(()=>calculateDamage(damage(),{source:{critChance:1.1}}));
});
test('all multiplier fields reject invalid numbers', () => {
  for(const value of [-0.1,NaN,Infinity,null,'1',true,undefined]){
    for(const key of ['critMultiplier','damageMultiplier','healingMultiplier'])assert.throws(()=>calculateHealing(healing(),{source:{[key]:value}}));
    for(const key of ['damageTakenMultiplier','healingTakenMultiplier'])assert.throws(()=>calculateDamage(damage(),{target:{[key]:value}}));
    assert.throws(()=>calculateDamage(damage(),{source:{schoolDamageMultipliers:{fire:value}}}));
  }
});
test('armor and all resistance entries validate even when irrelevant to healing', () => {
  for(const value of [-1,NaN,Infinity,null,'1',true]){
    assert.throws(()=>calculateHealing(healing(),{target:{armor:value}}));
    assert.throws(()=>calculateHealing(healing(),{target:{resistances:{frost:value}}}));
  }
});
test('invalid mitigation constants and caps', () => {
  for(const key of ['armorConstant','resistanceConstant'])for(const value of [0,-1,NaN,Infinity,null,'4000',true])assert.throws(()=>calculateMitigation('fire',{}, {[key]:value}));
  for(const value of [-0.1,1.1,NaN,Infinity,null,'0.5'])assert.throws(()=>calculateMitigation('fire',{}, {maxDamageReduction:value}));
  assert.throws(()=>calculateMitigation('chaos'));
});
test('malformed objects, unknown fields and non-boolean outcomes fail', () => {
  for(const context of [null,[],1,{source:null},{source:[]},{target:null},{rules:null},{outcome:null},{source:{schoolDamageMultipliers:null}},{target:{resistances:[]}},{source:{schoolDamageMultipliers:{chaos:1}}},{target:{resistances:{chaos:1}}},{outcome:{isCritical:1}},{outcome:{isCritical:'false'}},{outcome:{isCritical:undefined}},{source:{spellPower:undefined}},{source:{extra:1}},{typo:1}])assert.throws(()=>calculateCombatEffect(damage(),context));
});
test('overflow and unsafe rounded results fail explicitly', () => {
  assert.throws(()=>calculateDamage(damage({scalingStat:'spellPower',coefficient:1000}),{source:{spellPower:Number.MAX_VALUE}}));
  assert.throws(()=>calculateDamage(damage(),{source:{damageMultiplier:Number.MAX_VALUE}}));
  assert.throws(()=>calculateDamage(damage({baseAmount:1e9}),{source:{damageMultiplier:1e9}}));
});
test('different precomputed character stats and modifiers affect results', () => {
  const e=damage({scalingStat:'attackPower',coefficient:0.5});
  assert.equal(calculateDamage(e,{source:{attackPower:100,damageMultiplier:1}}).finalAmount,150);
  assert.equal(calculateDamage(e,{source:{attackPower:200,damageMultiplier:1.5}}).finalAmount,300);
});
test('deep-frozen inputs are unchanged and breakdowns are fresh', () => {
  const e=freeze(damage({school:'fire',scalingStat:'spellPower',coefficient:0.5}));
  const c=freeze({source:{spellPower:100,schoolDamageMultipliers:{fire:1.2}},target:{resistances:{fire:1000}},rules:{armorConstant:4000},outcome:{isCritical:true}});
  const before=JSON.stringify([e,c]);const first=calculateDamage(e,c);assert.equal(JSON.stringify([e,c]),before);
  first.multipliers.source=999;first.mitigation.reduction=999;assert.equal(calculateDamage(e,c).multipliers.source,1);
  calculateHealing(freeze(healing()),c);calculateMitigation('fire',c.target,c.rules);assert.equal(JSON.stringify([e,c]),before);
});
test('damage breakdown represents each pipeline stage', () => {
  const r=calculateDamage(damage({school:'fire',baseAmount:120,scalingStat:'spellPower',coefficient:0.65}),{source:{spellPower:200,damageMultiplier:1.1,schoolDamageMultipliers:{fire:1.2},critMultiplier:2},target:{damageTakenMultiplier:0.5,resistances:{fire:1000}},outcome:{isCritical:true}});
  assert.equal(r.effectId,'hit');assert.equal(r.type,'damage');assert.equal(r.school,'fire');
  assert.equal(r.baseAmount,120);assert.equal(r.scalingAmount,130);assert.equal(r.rawAmount,250);
  near(r.modifiedAmount,165);near(r.criticalAmount,330);assert.equal(r.isCritical,true);
  assert.deepEqual(r.multipliers,{source:1.1,school:1.2,target:0.5,critical:2,total:1.32});
  assert.equal(r.mitigation.reduction,0.2);near(r.mitigation.preventedAmount,66);near(r.unroundedAmount,264);assert.equal(r.finalAmount,264);
});
test('healing breakdown contains neutral school and mitigation', () => {
  const r=calculateHealing(healing({baseAmount:80,scalingStat:'attackPower',coefficient:0.2}),{source:{attackPower:100,healingMultiplier:1.5,critMultiplier:2},target:{healingTakenMultiplier:0.5},outcome:{isCritical:true}});
  assert.equal(r.scalingAmount,20);assert.equal(r.rawAmount,100);assert.equal(r.modifiedAmount,75);assert.equal(r.criticalAmount,150);assert.equal(r.finalAmount,150);
  assert.deepEqual(r.multipliers,{source:1.5,school:1,target:0.5,critical:2,total:1.5});assert.equal(r.mitigation.preventedAmount,0);
});
test('rounding happens once at the end for both damage and healing', () => {
  assert.equal(calculateDamage(damage({baseAmount:1.4}),{source:{damageMultiplier:1.4}}).finalAmount,2);
  assert.equal(calculateHealing(healing({baseAmount:2.5})).finalAmount,3);
  assert.equal(calculateDamage(damage({baseAmount:2.49})).finalAmount,2);
  assert.equal(calculateDamage(damage({baseAmount:1}),{target:{armor:4000}}).finalAmount,1);
});
