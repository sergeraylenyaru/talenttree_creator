import {ratingStats,validateCombatRules} from './rulesets.js';
import {combatSchools} from './effect-validation.js';

export const primaryStats = ['strength','agility','intellect','stamina','spirit'];
// Rounded per-attribute means from the six Human class rows at level 60 in Classic Era.
export const level60Primary = Object.freeze({strength:69,agility:67,intellect:74,stamina:82,spirit:92});

export function primaryPointsUsed(stats){
  return primaryStats.reduce((sum,key)=>sum+(stats?.[key]??0),0);
}

export const level60PrimaryBudget = primaryPointsUsed(level60Primary);
export const secondaryStats = [
  ...ratingStats,'attackPower','spellPower','healingPower','critChance','critMultiplier','haste','mastery','versatility',
  'armor','physicalResistance',...combatSchools.filter(school=>school!=='physical').map(school=>school+'Resistance'),
  'maxHealth','healthRegen','resourceRegen','movementSpeed','meleePower','rangedPower','spellDamage','cooldownRecovery'
];
export const attributes = [...primaryStats,...secondaryStats];
export const equipmentSlots = ['head','shoulders','chest','wrists','hands','waist','legs','feet','neck','back',
  'ring1','ring2','trinket1','trinket2','mainHand','offHand','ranged'];
export const qualities = ['common','uncommon','rare','epic','legendary'];
export const meleeWeapons = ['sword1','sword2','axe','mace','dagger','staff','wand'];
export const rangedWeapons = ['bow','crossbow','wand'];
const armorTypes = ['cloth','leather','mail','plate'];
export const itemTypes = [...armorTypes,'ring','necklace','trinket','cloak',...meleeWeapons,'bow','crossbow','shield'];
export const twoHanded = ['sword2','staff'];
export const hasteSystems = ['swing','cast','channel','gcd','cooldown'];
export const talentModifiers = ['damage','healing','cooldown','resourceGain','duration','period','procChance'];
export const procEvents = ['castStarted','castCompleted','attackHit','projectileHit','attackMissed','projectileMissed',
  'damage','healing','critical','periodicDamage','periodicHealing','statusApplied','statusExpired','absorbed',
  'resourceGained','resourceSpent','autoHit','cooldownCompleted'];
export const conditions = ['playerBelow','dummyBelow','critical','playerStatus','dummyStatus','resourceAbove','school','weapon'];

const own = (object,key) => Object.hasOwn(object,key);
const record = value => Boolean(value && typeof value==='object' && !Array.isArray(value));
const number = (value,min,max) => Number.isFinite(value) && value>=min && value<=max;
const identifier = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const text = (value,min,max) => typeof value==='string' && value.trim().length>=min && value.length<=max;

function fail(message) { throw Error(message); }
function schema(value, allowed, message) {
  if(!record(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail(message);
}
function collection(value, limit, callback) {
  if(value===undefined)return;
  if(!Array.isArray(value)||value.length>limit)fail('Invalid RPG collection');
  const ids=new Set();
  value.forEach((entry,index)=>{
    callback(entry,index);
    if(entry.id===undefined)return;
    if(!identifier(entry.id)||ids.has(entry.id))fail('Invalid or duplicate RPG identifier');
    ids.add(entry.id);
  });
}

export function itemTypesForSlot(slot) {
  if(slot==='mainHand')return meleeWeapons;
  if(slot==='offHand')return [...meleeWeapons.filter(type=>!twoHanded.includes(type)),'shield'];
  if(slot==='ranged')return rangedWeapons;
  if(slot==='neck')return ['necklace'];
  if(slot==='back')return ['cloak'];
  if(slot.startsWith('ring'))return ['ring'];
  if(slot.startsWith('trinket'))return ['trinket'];
  return armorTypes;
}

export function itemEligibility(item, slot, profile, equipped={}) {
  if(!item||item.disabled)return 'Item disabled';
  if(item.slot!==slot||!itemTypesForSlot(slot).includes(item.type))return 'Item does not fit this slot';
  if(profile.restrictions?.types?.length&&!profile.restrictions.types.includes(item.type))return 'Item type restricted for this class';
  if((item.requiredLevel??1)>(profile.level??1))return 'Character level too low';
  if(slot==='offHand') {
    if(twoHanded.includes(equipped.mainHand?.type))return 'A two-handed weapon occupies the off hand';
    if(item.type!=='shield'&&!profile.restrictions?.dualWield)return 'Dual wield is disabled';
  }
  if(slot==='mainHand'&&twoHanded.includes(item.type)&&equipped.offHand)return 'Unequip the off hand first';
  return '';
}

export function equippedItems(profile) {
  const library=new Map((profile?.items??[]).map(item=>[item.id,item]));
  return Object.fromEntries(Object.entries(profile?.equipped??{}).map(([slot,id])=>[slot,library.get(id)]));
}

function statMap(value, targets, min) {
  schema(value,targets,'Invalid character statistic');
  if(Object.entries(value).some(([key,n])=>!number(n,key==='critChance'?Math.max(-1,min):min,key==='critChance'?1:1e8)))fail('Character statistics must be finite numbers');
}

export function validateItem(item) {
  schema(item,['id','name','description','icon','level','quality','type','slot','armor','minDamage','maxDamage',
    'speed','stats','requiredLevel','disabled'],'Invalid item fields');
  if(!identifier(item.id)||!text(item.name,1,100)||!text(item.description??'',0,3000)||
    !identifier(item.icon)||!equipmentSlots.includes(item.slot)||!itemTypesForSlot(item.slot).includes(item.type)||
    !qualities.includes(item.quality)||!Number.isInteger(item.level)||!number(item.level,1,1000))fail('Check item identity, slot and quality');
  if(item.disabled!==undefined&&typeof item.disabled!=='boolean')fail('Invalid enabled state');
  if(item.requiredLevel!==undefined&&(!Number.isInteger(item.requiredLevel)||!number(item.requiredLevel,1,1000)))fail('Invalid item requirement');
  if(item.armor!==undefined&&!number(item.armor,0,1e8))fail('Invalid item armor');
  if(item.stats!==undefined)statMap(item.stats,attributes,-1e8);
  const weapon=[...meleeWeapons,...rangedWeapons].includes(item.type);
  if(weapon ? !number(item.minDamage,0,1e8)||!number(item.maxDamage,item.minDamage,1e8)||!number(item.speed,.4,30)
    : ['minDamage','maxDamage','speed'].some(key=>own(item,key)))fail('Check weapon damage and speed');
}

export function validateRpg(document, resources) {
  if(!own(document,'rpg'))return;
  const profile=document.rpg;
  const talents=new Map(document.branches.flatMap(branch=>branch.talents).map(talent=>[talent.id,talent]));
  const abilities=new Map(document.abilities.map(ability=>[ability.id,ability]));
  const resourceIds=resources.filter(resource=>resource.id!=='health').map(resource=>resource.id);
  const targets=[...secondaryStats,...resourceIds.map(id=>'resource:'+id)];
  schema(profile,['version','level','primaryBudget','attributes','formulas','items','equipped','restrictions','hasteUses','autoSlot',
    'resources','bonuses','procs','builds','incoming','seed','testDuration','combatRules'],'Invalid RPG profile fields');
  validateCombatRules(profile);
  if(profile.version!==1)fail('Unsupported RPG profile version');
  if(profile.seed!==undefined&&(!Number.isInteger(profile.seed)||!number(profile.seed,0,4294967295)))fail('Invalid test seed');
  if(profile.testDuration!==undefined&&!number(profile.testDuration,1,3600))fail('Invalid measurement duration');
  if(profile.level!==undefined&&(!Number.isInteger(profile.level)||!number(profile.level,1,1000)))fail('Invalid character level');
  if(profile.attributes!==undefined)statMap(profile.attributes,attributes,0);
  if(profile.primaryBudget!==undefined){
    if(!Number.isInteger(profile.primaryBudget)||!number(profile.primaryBudget,0,5e8))fail('Недопустимый бюджет характеристик');
    if(primaryStats.some(key=>!Number.isInteger(profile.attributes?.[key]??0)))fail('Распредели характеристики целыми очками');
    if(primaryPointsUsed(profile.attributes)>profile.primaryBudget)fail('Превышен бюджет базовых характеристик');
  }
  collection(profile.formulas,64,rule=>{
    schema(rule,['from','to','factor'],'Invalid formula');
    if(!primaryStats.includes(rule.from)||!targets.includes(rule.to)||!number(rule.factor,-10000,10000))fail('Invalid scaling formula');
  });
  collection(profile.items,128,validateItem);
  if(profile.restrictions!==undefined){
    schema(profile.restrictions,['types','dualWield'],'Invalid item restrictions');
    const {types,dualWield}=profile.restrictions;
    if(types!==undefined&&(!Array.isArray(types)||types.length>itemTypes.length||new Set(types).size!==types.length||
      types.some(type=>!itemTypes.includes(type))))fail('Invalid item types');
    if(dualWield!==undefined&&typeof dualWield!=='boolean')fail('Invalid dual-wield setting');
  }
  if(profile.hasteUses!==undefined&&(!Array.isArray(profile.hasteUses)||new Set(profile.hasteUses).size!==profile.hasteUses.length||
    profile.hasteUses.some(key=>!hasteSystems.includes(key))))fail('Invalid haste systems');
  if(profile.autoSlot!==undefined&&!['mainHand','ranged'].includes(profile.autoSlot))fail('Invalid autoattack slot');
  function validateEquipment(value){
    schema(value,equipmentSlots,'Invalid equipment slots');
    const equipped=equippedItems({...profile,equipped:value});
    for(const [slot,item] of Object.entries(equipped)){
      if(!item)fail('Equipped item is missing');
      const issue=itemEligibility(item,slot,profile,equipped);
      if(issue)fail(issue);
    }
  }
  if(profile.equipped!==undefined)validateEquipment(profile.equipped);
  if(profile.resources!==undefined){
    schema(profile.resources,resourceIds,'Unknown class resource');
    for(const rule of Object.values(profile.resources)){
      schema(rule,['regen','decay','onHit','onCrit'],'Invalid resource rule');
      if(Object.values(rule).some(value=>!number(value,0,1e6)))fail('Invalid resource amount');
    }
  }
  collection(profile.bonuses,64,rule=>{
    schema(rule,['id','owner','spell','stat','amount'],'Invalid passive or talent bonus');
    if(!identifier(rule.id))fail('Invalid bonus identifier');
    validateOwner(rule.owner,talents,abilities,profile.items);
    if(!attributes.includes(rule.stat)&&!talentModifiers.includes(rule.stat)||!number(rule.amount,-100,10000)||
      rule.spell!==undefined&&!abilities.has(rule.spell))fail('Invalid bonus statistic or ability');
    if(rule.spell&&attributes.includes(rule.stat))fail('Ability-specific bonuses must select an ability modifier');
  });
  collection(profile.procs,48,proc=>{
    schema(proc,['id','owner','name','event','chance','cooldown','every','condition','spell','effect','cost'],'Invalid proc fields');
    if(!identifier(proc.id))fail('Invalid trigger identifier');
    validateOwner(proc.owner,talents,abilities,profile.items);
    if(!text(proc.name,1,100)||!procEvents.includes(proc.event)||!number(proc.chance,0,1)||!number(proc.cooldown,0,3600)||
      !Number.isInteger(proc.every??1)||!number(proc.every??1,1,100)||
      !abilities.get(proc.spell)?.combatEffects?.some(effect=>effect.id===proc.effect))fail('Invalid proc trigger or effect reference');
    if(proc.condition!==undefined){
      const condition=proc.condition;
      schema(condition,['type','value','resource'],'Invalid proc condition');
      const valid={
        playerBelow:()=>number(condition.value,0,100),dummyBelow:()=>number(condition.value,0,100),
        critical:()=>condition.value===true,playerStatus:()=>text(condition.value,1,100),dummyStatus:()=>text(condition.value,1,100),
        resourceAbove:()=>resourceIds.includes(condition.resource)&&number(condition.value,0,1e8),
        school:()=>combatSchools.includes(condition.value),weapon:()=>itemTypes.includes(condition.value)
      };
      if(!conditions.includes(condition.type)||!valid[condition.type]())fail('Invalid proc condition value');
    }
    if(proc.cost!==undefined){
      schema(proc.cost,['resourceId','amount','unit'],'Invalid proc cost');
      if(!resourceIds.includes(proc.cost.resourceId)||!number(proc.cost.amount,0,proc.cost.unit==='percent'?100:1e8)||
        !['points','count','percent'].includes(proc.cost.unit))fail('Invalid proc resource cost');
    }
  });
  collection(profile.builds,24,build=>{
    schema(build,['id','name','talents','equipped','primaryBranchId'],'Invalid saved build');
    if(!identifier(build.id)||!text(build.name,1,100))fail('Invalid build name');
    if(build.primaryBranchId!==undefined&&build.primaryBranchId!==''&&!document.branches.some(branch=>branch.id===build.primaryBranchId))fail('Invalid saved specialization');
    schema(build.talents,[...talents.keys()],'Invalid saved talents');
    for(const [id,rank] of Object.entries(build.talents)){
      if(!Number.isInteger(rank)||!number(rank,0,talents.get(id).maxRank))fail('Invalid saved talent rank');
    }
    validateEquipment(build.equipped);
  });
  if(profile.incoming!==undefined){
    schema(profile.incoming,['school','amount'],'Invalid incoming damage test');
    if(!combatSchools.includes(profile.incoming.school)||!number(profile.incoming.amount,1,1e8))fail('Invalid incoming damage test');
  }
}

function validateOwner(owner,talents,abilities,items=[]){
  schema(owner,['kind','id','rank'],'Invalid passive source');
  const source=owner.kind==='talent'?talents.get(owner.id):['passive','ability'].includes(owner.kind)?abilities.get(owner.id):items.find(item=>item.id===owner.id);
  if(!source||!['talent','passive','ability','item'].includes(owner.kind)||
    owner.kind==='passive'&&source.kind!=='passive'||
    owner.rank!==undefined&&(owner.kind!=='talent'||!Number.isInteger(owner.rank)||!number(owner.rank,1,source.maxRank)))fail('Invalid passive source reference');
}

export function removeRpgReferences(profile, kind, id){
  if(!profile)return;
  for(const list of ['bonuses','procs'])if(profile[list])profile[list]=profile[list].filter(rule=>
    !(rule.owner.kind===kind&&rule.owner.id===id)&&!(kind==='passive'&&(rule.spell===id||rule.owner.kind==='ability'&&rule.owner.id===id)));
  if(kind==='talent')for(const build of profile.builds??[])delete build.talents[id];
  if(kind==='item')for(const equipped of [profile.equipped,...(profile.builds??[]).map(build=>build.equipped)]) {
    for(const [slot,value] of Object.entries(equipped??{}))if(value===id)delete equipped[slot];
  }
}
