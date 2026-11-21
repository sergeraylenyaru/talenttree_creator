// Attack-table helpers for the existing calculation/runtime, not a second engine.
// Evidence and unresolved cases: docs/cataclysm-rule-sources.md.
import {rollAttackOutcome,rollCritical} from './calculation-engine.js';
const clamp=value=>Math.max(0,Math.min(1,value));
export const normalizedWeaponSpeed=weapon=>weapon?.type==='dagger'?1.7:
  ['sword2','staff','axe2','mace2','polearm'].includes(weapon?.type)?3.3:['bow','crossbow','gun'].includes(weapon?.type)?2.8:2.4;
export function selectCombatWeapon(ability,sheet){
  const explicit=ability.weaponHand??ability.workshop?.weaponHand;
  const type=ability.workshop?.attackType;
  const ranged=explicit==='ranged'||!explicit&&(type==='ranged'||ability.isAuto&&ability.presentation?.delivery==='ranged'||
    ability.combatEffects.some(effect=>effect.type==='damage'&&effect.school==='physical')&&ability.presentation?.delivery==='ranged');
  const hand=explicit??(ranged?'ranged':'mainHand');
  return {hand,weapon:ability.autoWeapon??(hand==='offHand'?sheet.weapons.offHand:hand==='ranged'?sheet.weapons.ranged:sheet.weapons.melee)};
}
export function attackTable({ability,rules,crit=0,hand='mainHand',dualWield=false,position,targetControlled=false}){
  const primary=ability.combatEffects.find(effect=>effect.type==='damage');
  const type=ability.workshop?.attackType??(primary?.school==='physical'?(hand==='ranged'?'ranged':'melee'):'spell');
  const auto=Boolean(ability.isAuto),magic=type==='spell',melee=type==='melee';
  const delta=rules.targetLevel-rules.level;
  const miss=magic?(delta>2?.17+(delta-3)*.11:.04+delta*.01):
    (delta>2?.06+(delta-2)*.02:.05+delta*.005)+(auto&&melee&&dualWield?.19:0);
  const behind=(position??rules.position)==='behind';
  const suppression=magic?0:delta>2?.03+delta*.006:Math.max(0,delta)*.002;
  const dodge=targetControlled?0:.05+delta*.005;
  const parry=targetControlled?0:delta>2?.10+(delta-2)*.04:.05+delta*.005;
  const glancing=auto&&melee&&delta>=0?Math.min(.4,(delta+1)*.06):0;
  return {type,hand,position:behind?'behind':'front',singleRoll:auto,
    miss:Math.min(magic?.99:1,clamp(miss-(magic?rules.spellHit:rules.hit))),dodge:melee?clamp(dodge-rules.expertise):0,
    parry:melee&&!behind?clamp(parry-rules.expertise):0,
    block:melee&&!behind&&!targetControlled?.05:0,glancing,critical:clamp(crit-suppression),
    glancingMultiplier:Math.max(.05,Math.min(.95,1.05-Math.max(0,delta)*.1))};
}
export function resolveAttackTable(table,random){
  const roll=random();
  const outcome=rollAttackOutcome({...table,critical:table.singleRoll?table.critical:0},roll);
  const isCritical=outcome==='critical'||outcome==='hit'&&!table.singleRoll&&table.critical>0&&rollCritical(table.critical,random());
  return {outcome,isCritical,table,roll};
}

export function targetSide(origin,target){
 const dx=origin.x-target.position.x,dz=origin.z-target.position.z;
 return dx*Math.sin(target.facing??0)+dz*Math.cos(target.facing??0)>=0?'front':'behind';
}
