import {conditionMatches} from './conditions.js';
import {progressionValues} from './progression.js';
import {combatRuleValues} from './rulesets.js';
import {abilityUnlocked} from '../engine.js';
import {calculateMitigation} from './calculation-engine.js';
import {combatSchools} from './effect-validation.js';
import {equippedItems, primaryStats,stateMatches} from './rpg-profile.js';
import {modifier} from './active-effects.js';

export function compileProfile(document, passiveAbilities) {
  const profile=document.rpg;
  if(!profile&&!passiveAbilities.some(ability=>ability.combatEffects.some(effect=>effect.type==='status')))return undefined;
  const equipment=equippedItems(profile);
  const sets=(profile?.setBonuses??[]).filter(bonus=>Object.values(equipment).filter(item=>item.setId===bonus.setId).length>=bonus.pieces);
  const selected=new Set(passiveAbilities.map(ability=>ability.id));
  const active=owner=>owner.kind==='talent'?(document.build[owner.id]??0)>=(owner.rank??1)
    :owner.kind==='ability'?document.abilities.some(ability=>ability.id===owner.id&&abilityUnlocked(document,ability))
    :owner.kind==='set'?sets.some(bonus=>bonus.id===owner.id)
    :owner.kind==='passive'?selected.has(owner.id):Object.values(equipment).some(item=>item.id===owner.id);
  const passiveStats=passiveAbilities.flatMap(ability=>ability.combatEffects.filter(effect=>
    effect.type==='status'&&effect.target==='player'&&!effect.consumeOnHit));
  return {...profile,learnedTalents:{...document.build},equipment,sets,passiveStats,bonuses:(profile?.bonuses??[]).filter(rule=>active(rule.owner)),
    procs:(profile?.procs??[]).filter(proc=>active(proc.owner)).map(proc=>({
      ...proc, ability:document.abilities.find(ability=>ability.id===proc.spell)
    }))};
}

export function abilityBonusDetails(profile,id,key,states=profile?.states??{},context){
  return (profile?.bonuses??[]).flatMap(rule=>{
    if(!stateMatches(rule,states)||rule.stat!==key||rule.spell&&rule.spell!==id)return [];
    if(rule.condition&&(!context||!conditionMatches(rule.condition,context.event,context.state,context.statuses,context.weapon,{talents:profile.learnedTalents})))return [];
    const masteryPoints=context?.masteryPoints??0;
    return [{id:rule.id,owner:rule.owner,stat:key,base:rule.amount,masteryScale:rule.masteryScale??0,masteryPoints,
      amount:rule.amount+(rule.masteryScale??0)*masteryPoints}];
  });
}
export function abilityBonuses(profile,id,key,states,context){
  return abilityBonusDetails(profile,id,key,states,context).reduce((sum,rule)=>sum+rule.amount/100,0);
}

const nonnegative=value=>Math.max(0,value);
export function deriveCharacterStats(build,statuses=[],classStates=build.profile?.states??{}){
  const {profile}=build;
  const stats={...build.stats};
  const contributions=[];
  function add(source,key,value){
    stats[key]=(stats[key]??0)+value;
    if(value)contributions.push({source,key,value});
  }
  for(const key of primaryStats)stats[key]=0;
  for(const [key,value] of Object.entries(profile?.attributes??{}))stats[key]=value;
  const growth=progressionValues(profile);
  for(const [key,value] of Object.entries(growth.attributes))add('Level progression',key,value);
  add('Level progression','maxHealth',growth.health);
  for(const [key,value] of Object.entries(growth.resources))add('Level progression','resource:'+key,value);
  const equipment=profile?.equipment??{};
  for(const item of Object.values(equipment)){
    add(item.name,'armor',item.armor??0);
    for(const [key,value] of Object.entries(item.stats??{}))add(item.name,key,value);
  }
  for(const bonus of profile?.sets??[])for(const [key,value] of Object.entries(bonus.stats??{}))add(bonus.name,key,value);
  for(const rule of profile?.bonuses??[]){
    if(!stateMatches(rule,classStates))continue;
    if(!rule.spell&&(primaryStats.includes(rule.stat)||!['damage','healing','cooldown','cost','castTime','maxStacks','resourceGain','duration','period','procChance'].includes(rule.stat))) {
      add(rule.owner.id,rule.stat,rule.amount);
    }
  }
  for(const rule of profile?.formulas??[])add(rule.from+' × '+rule.factor,rule.to,nonnegative(stats[rule.from]??0)*rule.factor);
  const combatRules=combatRuleValues(profile,stats,classStates);
  if(combatRules){
    add('Cataclysm primary attributes','attackPower',combatRules.attackPower);
    add('Cataclysm primary attributes','spellPower',combatRules.spellPower);
    add('Cataclysm primary attributes','maxHealth',combatRules.health);
    add('Cataclysm rating','haste',combatRules.haste*100);
    add('Cataclysm rating','critChance',combatRules.crit);
  }
  function percent(key){
    return modifier(statuses,'player',key)+(profile?.passiveStats??[]).reduce((total,effect)=>
      effect.stat===key?total+effect.amount/100:total,0);
  }
  function boosted(key, fallback=0){
    return nonnegative((stats[key]??fallback)*(1+percent(key)));
  }
  const resistance=Object.fromEntries(combatSchools.filter(school=>school!=='physical').map(school=>[school,boosted(school+'Resistance')]));
  const armor=boosted('armor')+boosted('physicalResistance');
  const haste=(stats.haste??0)/100+percent('haste');
  const cooldownRecovery=boosted('cooldownRecovery')/100;
  const speed=key=>profile?.hasteUses?.includes(key)?Math.max(.1,1+haste):1;
  const versatile=combatRules?0:boosted('versatility')/100;
  const mastery=combatRules?0:boosted('mastery')/100;
  const swing=equipment[profile?.autoSlot??'mainHand'];
  const maxHealth=Math.max(1,Math.round(((build.baseHealth??build.maxHealth)+(stats.maxHealth??0))*(1+percent('maxHealth'))));
  return {
    combatRules,
    primary:Object.fromEntries(primaryStats.map(key=>[key,nonnegative(stats[key])])),
    source:{
      attackPower:boosted('attackPower'),spellPower:boosted('spellPower'),
      critChance:Math.max(0,Math.min(1,(stats.critChance??0)+percent('critChance'))),
      critMultiplier:boosted('critMultiplier',2),damageMultiplier:(stats.damageMultiplier??1)*(1+versatile+mastery),
      healingMultiplier:(stats.healingMultiplier??1)*(1+versatile+mastery)*Math.max(0,1+percent('healingDone')),
      ...(stats.schoolDamageMultipliers?{schoolDamageMultipliers:stats.schoolDamageMultipliers}:{})
    },
    healingPower:boosted('healingPower'),meleePower:boosted('meleePower'),rangedPower:boosted('rangedPower'),spellDamage:boosted('spellDamage'),
    maxHealth,healthRegen:boosted('healthRegen'),resourceRegen:boosted('resourceRegen'), armor,resistance,
    defense:Math.max(0,(1-Math.min(.95,versatile/2))*(1+percent('damageTaken'))), haste, versatility:versatile, mastery,
    movementSpeed:Math.max(.1,(stats.movementSpeed??1)*(1+percent('movementSpeed'))),
    castSpeed:speed('cast'),channelSpeed:speed('channel'),gcdSpeed:speed('gcd'),
    cooldownSpeed:speed('cooldown')*(1+cooldownRecovery),swingSpeed:speed('swing'),weapon:swing,
    weapons:{melee:equipment.mainHand,ranged:equipment.ranged,offHand:equipment.offHand},
    damageModifiers:[...statuses.filter(status=>status.target==='player'&&status.effect.stat==='damageDone'),
      ...(profile?.passiveStats??[]).filter(effect=>effect.stat==='damageDone').map(effect=>({effect,stacks:1}))],
    resources:(build.baseResources??build.resources).map(resource=>{
      const max=Math.max(1,Math.round((resource.max+(stats['resource:'+resource.id]??0)+(combatRules&&(profile?.resources?.[resource.id]?.kind?profile.resources[resource.id].kind==='mana':/mana/i.test(resource.id))?combatRules.mana:0))*(1+percent('maxResource'))));
      return {...resource,max,current:Math.min(max,resource.current),...profile?.resources?.[resource.id]};
    }),
    mitigation:{physical:calculateMitigation('physical',{armor},combatRules?{armorConstant:combatRules.armorConstant}:undefined).reduction,
      ...Object.fromEntries(Object.keys(resistance).map(school=>[school,calculateMitigation(school,{resistances:resistance},combatRules?{resistanceConstant:combatRules.resistanceConstant}:undefined).reduction]))},
    contributions
  };
}

export function weaponTiming(sheet, fallback) {
  const weapon=sheet.weapon;
  return {speed:weapon?.speed??fallback.swingSeconds,swingSeconds:(weapon?.speed??fallback.swingSeconds)/sheet.swingSpeed,
    minDamage:weapon?.minDamage??fallback.damage,maxDamage:weapon?.maxDamage??fallback.damage,
    type:weapon?.type??'sword1',ranged:['bow','crossbow','wand','gun'].includes(weapon?.type),offHand:undefined};
}
