import {visitConditions} from './conditions.js';
// Provenance is descriptive metadata. Combat never reads a mutable source template.
const identity=()=>crypto.randomUUID();
const lists=['bonuses','procs'];
function body(source,id){
  const copy=structuredClone(source);
  delete copy.templateRules;delete copy.templateAbilities;delete copy.instanceOwnerId;
  Object.assign(copy,{id,templateSource:{id:source.id,name:source.name},talentId:'',branchId:'',branchOnly:false,learningMode:'base'});
  return copy;
}
function rulesFor(document,source){
  return Object.fromEntries(lists.map(key=>[key,structuredClone(source.templateRules?.[key]??
    (document?.rpg?.[key]??[]).filter(rule=>rule.spell===source.id||
      ['passive','ability'].includes(rule.owner.kind)&&rule.owner.id===source.id))]));
}
function bundle(document,source,id,detachOwners){
  const library=new Map([...(document?.abilities??[]),...(source.templateAbilities??[]),source].map(ability=>[ability.id,ability]));
  const records=new Map([[source.id,source]]),rules={bonuses:new Map(),procs:new Map()};
  const queue=[source];
  for(let index=0;index<queue.length;index++){
    const current=queue[index],captured=rulesFor(document,current);
    const references=current.combatEffects?.filter(effect=>effect.type==='cooldown'&&effect.abilityId!=='self').map(effect=>effect.abilityId)??[];
    for(const key of lists)for(const rule of captured[key]){
      rules[key].set(rule.id,rule);
      if(rule.spell)references.push(rule.spell);
      if(rule.sourceAbilityId)references.push(rule.sourceAbilityId);
      visitConditions(rule.condition,condition=>{if(condition.abilityId)references.push(condition.abilityId);if(['playerStatus','dummyStatus','auraStacks'].includes(condition.type)&&library.has(condition.value))references.push(condition.value);});
    }
    for(const reference of references){
      if(records.has(reference))continue;
      const dependency=library.get(reference);
      if(!dependency)throw Error('Referenced template ability is unavailable: '+reference);
      records.set(reference,dependency);queue.push(dependency);
    }
  }
  const remap=new Map([...records.keys()].map(key=>[key,key===source.id?id:identity()]));
  const copies=[...records.values()].map(record=>{
    const copy=body(record,remap.get(record.id));
    for(const effect of copy.combatEffects??[])if(effect.type==='cooldown'&&remap.has(effect.abilityId))effect.abilityId=remap.get(effect.abilityId);
    return copy;
  });
  const root=copies.shift();
  root.templateRules=Object.fromEntries(lists.map(key=>[key,[...rules[key].values()].map(rule=>{
    rule=structuredClone(rule);rule.id=identity();
    if(remap.has(rule.owner.id)&&['ability','passive'].includes(rule.owner.kind))rule.owner.id=remap.get(rule.owner.id);
    else if(detachOwners)rule.owner={kind:'ability',id:remap.get(rule.spell)??id};
    if(remap.has(rule.spell))rule.spell=remap.get(rule.spell);
    if(remap.has(rule.sourceAbilityId))rule.sourceAbilityId=remap.get(rule.sourceAbilityId);
    visitConditions(rule.condition,condition=>{if(['playerStatus','dummyStatus','auraStacks'].includes(condition.type)&&remap.has(condition.value))condition.value=remap.get(condition.value);if(remap.has(condition.abilityId))condition.abilityId=remap.get(condition.abilityId);});
    return rule;
  })]));
  if(copies.length)root.templateAbilities=copies.map(ability=>({...ability,instanceOwnerId:id}));
  return root;
}

export function copyAbility(source,id=identity()) {
  return source.templateRules||source.templateAbilities?bundle(null,source,id,true):body(source,id);
}
export function abilityTemplateSnapshot(document,source){return bundle(document,source,identity(),true);}

export function appendAbilityInstance(document,instance){
  const next=structuredClone(document);
  let ability=structuredClone(instance);
  const source=document.abilities.find(entry=>entry.id===instance.templateSource?.id);
  if(!ability.templateRules&&!ability.templateAbilities&&source){
    const captured=bundle(document,{...source,...instance,id:source.id},instance.id,false);
    ability={...captured,learningMode:instance.learningMode,talentId:instance.talentId,branchId:instance.branchId,branchOnly:instance.branchOnly};
  }
  const dependencies=ability.templateAbilities??[],rules=ability.templateRules??{};
  delete ability.templateRules;delete ability.templateAbilities;
  next.abilities.push(ability,...structuredClone(dependencies));
  for(const [key,entries] of Object.entries(rules)){
    if(!entries.length)continue;
    next.rpg??={version:1};next.rpg[key]??=[];next.rpg[key].push(...structuredClone(entries));
  }
  return {document:next,ability};
}
export function replaceAbilityInstance(document,instance){
  const next=structuredClone(document),index=next.abilities.findIndex(entry=>entry.id===instance.id);
  if(index<0)throw Error('Ability instance is unavailable');
  if(!instance.templateRules&&!instance.templateAbilities){next.abilities[index]=structuredClone(instance);return next;}
  next.abilities.splice(index,1);
  for(const key of lists)if(next.rpg?.[key])next.rpg[key]=next.rpg[key].filter(rule=>
    !(['ability','passive'].includes(rule.owner.kind)&&rule.owner.id===instance.id));
  const result=appendAbilityInstance(next,instance).document;
  const placed=result.abilities.findIndex(entry=>entry.id===instance.id);
  result.abilities.splice(index,0,result.abilities.splice(placed,1)[0]);
  return result;
}
export function copyAbilityIntoDocument(document,source,id=identity()){
  return appendAbilityInstance(document,bundle(document,source,id,false));
}
export function validateTemplateSource(ability){
  if(ability.templateSource===undefined)return;
  const source=ability.templateSource;
  if(!source||typeof source!=='object'||Array.isArray(source)||Object.keys(source).some(key=>!['id','name'].includes(key))||
    ['id','name'].some(key=>typeof source[key]!=='string'||!source[key]||source[key].length>200))throw Error('Проверь источник шаблона способности');
}
