const aliases={Health:'Здоровье',Mana:'Мана',Energy:'Энергия',Rage:'Ярость'};
const sameName=(a,b)=>(aliases[a]||a)===(aliases[b]||b);
export function classResources(character){
 const resources=character?.resources??[{name:'Мана',unit:'percent'}];
 return [{id:'health',name:'Здоровье',unit:'points'},...resources.map((r,i)=>({id:r.id||'legacy:'+i,name:r.name,unit:r.unit||'points'}))];
}
export function abilityResourceCosts(ability,character){
 if(Array.isArray(ability.resourceCosts))return ability.resourceCosts.map(c=>({...c}));
 if(!ability.resourceType)return [];
 const choice=classResources(character).find(r=>sameName(r.name,ability.resourceType));
 return [{resourceId:choice?.id||'',resourceName:choice?.name||ability.resourceType,amount:Number.parseFloat(ability.resource)||0,unit:ability.resourceUnit||'points'}];
}
export function validateResourceCosts(ability,character){
 if(ability.resourceCosts===undefined)return;
 if(!Array.isArray(ability.resourceCosts))throw Error('Проверь затраты ресурсов');
 const available=new Set(classResources(character).map(r=>r.id)),seen=new Set();
 for(const cost of ability.resourceCosts){
  if(!cost||typeof cost.resourceId!=='string'||!available.has(cost.resourceId)||seen.has(cost.resourceId)||!Number.isFinite(cost.amount)||cost.amount<0||cost.amount>1e9||!['points','percent','count'].includes(cost.unit)||cost.resourceName!==undefined&&(typeof cost.resourceName!=='string'||cost.resourceName.length>100))throw Error('Выбери ресурсы класса для каждой затраты и проверь количество');
  seen.add(cost.resourceId);
 }
}
export function reconcileResourceCosts(abilities,previous,next){
 const before=classResources(previous),after=classResources(next);
 return abilities.map(ability=>{
  const copy=structuredClone(ability);
  if(copy.resourceCosts){
   copy.resourceCosts=copy.resourceCosts.map(cost=>{
    const resource=after.find(r=>r.id===cost.resourceId);
    if(!resource)throw Error('Ресурс используется способностью: '+ability.name+'. Сначала убери или измени её затрату.');
    return {...cost,resourceName:resource.name};
   });
  }else if(copy.resourceType){
   const old=before.find(r=>sameName(r.name,copy.resourceType)),resource=old&&after.find(r=>r.id===old.id);
   if(old&&!resource&&Number.parseFloat(copy.resource)>0)throw Error('Ресурс используется способностью: '+ability.name+'. Сначала убери или измени её затрату.');
   if(resource)copy.resourceType=resource.name;
  }
  return copy;
 });
}
export function adaptResourceCosts(ability,character){
 if(!ability.resourceCosts)return ability;
 const available=classResources(character);
 return {...ability,resourceCosts:ability.resourceCosts.map(c=>{const resource=available.find(r=>c.resourceId==='health'?r.id==='health':r.id!=='health'&&(sameName(r.name,c.resourceName)||!c.resourceName&&r.id===c.resourceId));return {...c,resourceId:resource?.id||'',resourceName:resource?.name||c.resourceName};})};
}
