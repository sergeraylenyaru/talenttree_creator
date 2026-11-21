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
export const qualities = ['poor','common','uncommon','rare','epic','legendary'];
export const meleeWeapons = ['sword1','sword2','axe','mace','dagger','staff','wand','axe2','mace2','polearm','fist'];
export const rangedWeapons = ['bow','crossbow','wand','gun'];
const armorTypes = ['cloth','leather','mail','plate'];
export const itemTypes = [...armorTypes,'ring','necklace','trinket','cloak',...meleeWeapons,'bow','crossbow','gun','shield','holdable'];
export const twoHanded = ['sword2','staff','axe2','mace2','polearm'];
export const hasteSystems = ['swing','cast','channel','gcd','cooldown','rune','periodic'];
export const talentModifiers = ['damage','healing','cooldown','cost','castTime','maxStacks','resourceGain','duration','period','procChance'];
export const procEvents = ['castStarted','castCompleted','attackHit','projectileHit','attackMissed','projectileMissed',
  'damage','healing','critical','periodicDamage','periodicHealing','statusApplied','statusExpired','absorbed',
  'resourceGained','resourceSpent','autoHit','cooldownGroupCompleted','cooldownCompleted','incomingDamage','criticalHeal','criticalDamage','statusStacked','channelTick','targetDefeated','dodge','parry','block','dispelled'];
export const conditions = ['playerBelow','dummyBelow','critical','playerStatus','dummyStatus','resourceAbove','resourceBelow','school','weapon','auraStacks','state','talentRank','previousEvent','all','any','not'];

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
  if(slot==='offHand')return [...meleeWeapons.filter(type=>!twoHanded.includes(type)),'shield','holdable'];
  if(slot==='ranged')return rangedWeapons;
  if(slot==='neck')return ['necklace'];
  if(slot==='back')return ['cloak'];
  if(slot.startsWith('ring'))return ['ring'];
  if(slot.startsWith('trinket'))return ['trinket'];
  return armorTypes;
}

export function itemEligibility(item, slot, profile, equipped={}) {
  if(!item||item.disabled)return 'Item disabled';
  if(!(item.allowedSlots??[item.slot]).includes(slot)||!itemTypesForSlot(slot).includes(item.type))return 'Item does not fit this slot';
  if(profile.restrictions?.types?.length&&!profile.restrictions.types.includes(item.type))return 'Item type restricted for this class';
  if(item.requiredClasses&&!item.requiredClasses.includes(profile.combatRules?.classId))return 'Item class requirement';
  if(Object.entries(equipped).some(([other,current])=>other!==slot&&current?.id===item.id))return 'This item copy is already equipped in another slot';
  if(item.uniqueGroup&&Object.entries(equipped).some(([other,current])=>other!==slot&&current?.uniqueGroup===item.uniqueGroup))return 'Unique-equipped item already equipped';
  if(item.requiredClass&&item.requiredClass!==profile.combatRules?.classId)return 'Item class requirement';
  if((item.requiredLevel??1)>(profile.level??1))return 'Character level too low';
  if(slot==='offHand') {
    if(twoHanded.includes(equipped.mainHand?.type))return 'A two-handed weapon occupies the off hand';
    if(!['shield','holdable'].includes(item.type)&&!profile.restrictions?.dualWield)return 'Dual wield is disabled';
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
    'speed','stats','requiredLevel','requiredClass','setId','disabled','roll','allowedSlots','requiredClasses','uniqueGroup','source'],'Invalid item fields');
  if(!identifier(item.id)||!text(item.name,1,100)||!text(item.description??'',0,3000)||
    !identifier(item.icon)||!equipmentSlots.includes(item.slot)||!itemTypesForSlot(item.slot).includes(item.type)||
    !qualities.includes(item.quality)||!Number.isInteger(item.level)||!number(item.level,1,1000))fail('Check item identity, slot and quality');
  if(item.setId!==undefined&&!identifier(item.setId)||item.requiredClass!==undefined&&!['warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid','deathknight'].includes(item.requiredClass))fail('Invalid item class or set');
  if(item.allowedSlots!==undefined&&(!Array.isArray(item.allowedSlots)||!item.allowedSlots.length||item.allowedSlots.length>2||new Set(item.allowedSlots).size!==item.allowedSlots.length||!item.allowedSlots.includes(item.slot)||item.allowedSlots.some(slot=>!equipmentSlots.includes(slot)||!itemTypesForSlot(slot).includes(item.type))||item.allowedSlots.length===2&&![["mainHand","offHand"],["ring1","ring2"],["trinket1","trinket2"]].some(pair=>pair.every(slot=>item.allowedSlots.includes(slot)))))fail('Invalid allowed item slots');
  if(item.requiredClasses!==undefined&&(!Array.isArray(item.requiredClasses)||!item.requiredClasses.length||item.requiredClasses.length>10||new Set(item.requiredClasses).size!==item.requiredClasses.length||item.requiredClasses.some(key=>!['warrior','paladin','hunter','rogue','priest','shaman','mage','warlock','druid','deathknight'].includes(key))||item.requiredClass&&!item.requiredClasses.includes(item.requiredClass)))fail('Invalid item class restrictions');
  if(item.uniqueGroup!==undefined&&!identifier(item.uniqueGroup))fail('Invalid unique item group');
  if(item.source!==undefined)validateItemSource(item.source);
  if(item.disabled!==undefined&&typeof item.disabled!=='boolean')fail('Invalid enabled state');
  if(item.requiredLevel!==undefined&&(!Number.isInteger(item.requiredLevel)||!number(item.requiredLevel,1,1000)))fail('Invalid item requirement');
  if(item.armor!==undefined&&!number(item.armor,0,1e8))fail('Invalid item armor');
  if(item.stats!==undefined)statMap(item.stats,attributes,-1e8);
  if(item.roll!==undefined){
    schema(item.roll,['seed','spread','baseStats'],'Invalid item roll');
    if(!Number.isInteger(item.roll.seed)||!number(item.roll.seed,0,4294967295)||!number(item.roll.spread,0,1))fail('Invalid item roll');
    statMap(item.roll.baseStats,attributes,-1e8);
  }
  const weapon=[...meleeWeapons,...rangedWeapons].includes(item.type);
  if(weapon ? !number(item.minDamage,0,1e8)||!number(item.maxDamage,item.minDamage,1e8)||!number(item.speed,.4,30)
    : ['minDamage','maxDamage','speed'].some(key=>own(item,key)))fail('Check weapon damage and speed');
}

export function validateRpg(document, resources) {
  for(const ability of document.abilities){
    for(const effect of ability.combatEffects??[])if(effect.type==='rune'&&[effect.fromResource,effect.toResource].some(id=>!resources.some(resource=>resource.id===id)||!document.rpg?.resources?.[id]?.rune))fail('Rune conversion requires two configured rune resources');
    const substitute=ability.workshop?.runeSubstitute;
    if(substitute&&(!resources.some(resource=>resource.id===substitute)||!document.rpg?.resources?.[substitute]?.rune))fail('Rune substitute is not configured');
  }
  if(!own(document,'rpg'))return;
  const profile=document.rpg;
  const talents=new Map(document.branches.flatMap(branch=>branch.talents).map(talent=>[talent.id,talent]));
  const abilities=new Map(document.abilities.map(ability=>[ability.id,ability]));
  const resourceIds=resources.filter(resource=>resource.id!=='health').map(resource=>resource.id);
  const targets=[...secondaryStats,...resourceIds.map(id=>'resource:'+id)];
  schema(profile,['version','level','primaryBudget','attributes','formulas','items','equipped','restrictions','hasteUses','autoSlot',
    'resources','bonuses','procs','builds','incoming','seed','testDuration','combatRules','states','trainingMode','setBonuses','progression'],'Invalid RPG profile fields');
  validateCombatRules(profile);
  if(profile.trainingMode!==undefined&&!['normal','dps','hps','survival','rotation','resource','ability'].includes(profile.trainingMode))fail('Invalid training mode');
  if(profile.states!==undefined){
    schema(profile.states,['form','stance','aspect','seal','mode'],'Invalid class state');
    if(Object.values(profile.states).some(value=>typeof value!=='string'||!value||value.length>60))fail('Invalid class state');
  }
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
  if(profile.progression!==undefined){
    const growth=profile.progression;
    schema(growth,['baseLevel','healthPerLevel','attributesPerLevel','resourcePerLevel'],'Invalid level progression');
    if(!Number.isInteger(growth.baseLevel)||!number(growth.baseLevel,1,1000)||growth.healthPerLevel!==undefined&&!number(growth.healthPerLevel,0,1e5))fail('Invalid progression level or health');
    statMap(growth.attributesPerLevel??{},primaryStats,0);
    if(Object.values(growth.attributesPerLevel??{}).some(value=>value>1e5))fail('Invalid attribute progression');
    schema(growth.resourcePerLevel??{},resourceIds,'Invalid progression resource');
    if(Object.values(growth.resourcePerLevel??{}).some(value=>!number(value,0,1e5)))fail('Invalid resource progression');
  }
  collection(profile.formulas,64,rule=>{
    schema(rule,['from','to','factor'],'Invalid formula');
    if(!primaryStats.includes(rule.from)||!targets.includes(rule.to)||!number(rule.factor,-10000,10000))fail('Invalid scaling formula');
  });
  collection(profile.items,128,validateItem);
  collection(profile.setBonuses,32,bonus=>{
    schema(bonus,['id','name','setId','pieces','stats'],'Invalid set bonus');
    if(!identifier(bonus.id)||!identifier(bonus.setId)||!text(bonus.name,1,100)||
      !Number.isInteger(bonus.pieces)||!number(bonus.pieces,1,17))fail('Invalid set bonus');
    statMap(bonus.stats??{},attributes,-1e8);
  });
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
      schema(rule,['regen','outOfCombatRegen','decay','onHit','onCrit','rune','recharge','kind'],'Invalid resource rule');
      if(Object.entries(rule).some(([key,value])=>key==='rune'?typeof value!=='boolean':key==='kind'?!['mana','energy','rage','focus','combo','rune','custom'].includes(value):!number(value,key==='recharge'?.25:0,key==='recharge'?120:1e6)))fail('Invalid resource amount');
    }
  }
  collection(profile.bonuses,64,rule=>{
    schema(rule,['id','owner','spell','stat','amount','state','condition','masteryScale'],'Invalid passive or talent bonus');
    if(!identifier(rule.id))fail('Invalid bonus identifier');
    validateStateCondition(rule.state);
    if(rule.condition!==undefined)validateCondition(rule.condition,resourceIds,talents,abilities);
    if((rule.condition!==undefined||rule.masteryScale!==undefined)&&!talentModifiers.includes(rule.stat))fail('Conditions and mastery scaling require an ability modifier');
    if(rule.masteryScale!==undefined&&!number(rule.masteryScale,0,100))fail('Invalid mastery scale');
    validateOwner(rule.owner,talents,abilities,profile.items,profile.setBonuses);
    if(!attributes.includes(rule.stat)&&!talentModifiers.includes(rule.stat)||!number(rule.amount,-100,10000)||
      rule.spell!==undefined&&!abilities.has(rule.spell))fail('Invalid bonus statistic or ability');
    if(rule.spell&&attributes.includes(rule.stat))fail('Ability-specific bonuses must select an ability modifier');
  });
  collection(profile.procs,48,proc=>{
    schema(proc,['id','owner','name','event','chance','cooldown','every','condition','spell','effect','cost','chain','priority','charges','sourceAbilityId','school','attackType','consecutive','state','ppm'],'Invalid proc fields');
    if(!identifier(proc.id))fail('Invalid trigger identifier');
    validateStateCondition(proc.state);
    if(proc.ppm!==undefined&&(!number(proc.ppm,.01,60)||proc.attackType!=='auto'))fail('PPM requires the autoattack filter');
    if(proc.consecutive!==undefined&&typeof proc.consecutive!=='boolean'||proc.chain!==undefined&&typeof proc.chain!=='boolean'||
      proc.priority!==undefined&&(!Number.isInteger(proc.priority)||!number(proc.priority,0,1000))||
      proc.charges!==undefined&&(!Number.isInteger(proc.charges)||!number(proc.charges,1,1000))||
      proc.sourceAbilityId!==undefined&&!abilities.has(proc.sourceAbilityId)||
      proc.school!==undefined&&!combatSchools.includes(proc.school)||
      proc.attackType!==undefined&&!['auto','direct','periodic'].includes(proc.attackType))fail('Invalid proc limits');
    validateOwner(proc.owner,talents,abilities,profile.items,profile.setBonuses);
    if(!text(proc.name,1,100)||!procEvents.includes(proc.event)||!number(proc.chance,0,1)||!number(proc.cooldown,0,3600)||
      !Number.isInteger(proc.every??1)||!number(proc.every??1,1,100)||
      !abilities.get(proc.spell)?.combatEffects?.some(effect=>effect.id===proc.effect))fail('Invalid proc trigger or effect reference');
    if(proc.condition!==undefined)validateCondition(proc.condition,resourceIds,talents,abilities);
    if(proc.cost!==undefined){
      schema(proc.cost,['resourceId','amount','unit'],'Invalid proc cost');
      if(!resourceIds.includes(proc.cost.resourceId)||!number(proc.cost.amount,0,proc.cost.unit==='percent'?100:1e8)||
        !['points','count','percent'].includes(proc.cost.unit))fail('Invalid proc resource cost');
    }
  });
  collection(profile.builds,24,build=>{
    schema(build,['id','name','talents','equipped','primaryBranchId','combatSnapshot'],'Invalid saved build');
    if(!identifier(build.id)||!text(build.name,1,100))fail('Invalid build name');
    if(build.combatSnapshot!==undefined){
      const saved=build.combatSnapshot;
      if(!record(saved)||saved.version!==1||!record(saved.rpg)||!Array.isArray(saved.rpg.builds)||saved.rpg.builds.length||
        JSON.stringify(saved.build??{})!==JSON.stringify(build.talents)||JSON.stringify(saved.rpg.equipped??{})!==JSON.stringify(build.equipped))fail('Invalid detached build snapshot');
      return;
    }
    if(build.primaryBranchId!==undefined&&build.primaryBranchId!==''&&!document.branches.some(branch=>branch.id===build.primaryBranchId))fail('Invalid saved specialization');
    schema(build.talents,[...talents.keys()],'Invalid saved talents');
    for(const [id,rank] of Object.entries(build.talents)){
      if(!Number.isInteger(rank)||!number(rank,0,talents.get(id).maxRank))fail('Invalid saved talent rank');
    }
    validateEquipment(build.equipped);
  });
  if(profile.incoming!==undefined){
    schema(profile.incoming,['school','amount','canCrit','critChance','critMultiplier','interval','castTime'],'Invalid incoming damage test');
    if(profile.incoming.castTime!==undefined&&!number(profile.incoming.castTime,.25,30))fail('Invalid dummy cast time');
    if(profile.incoming.interval!==undefined&&!number(profile.incoming.interval,.25,120))fail('Invalid incoming interval');
    if(profile.incoming.canCrit!==undefined&&typeof profile.incoming.canCrit!=='boolean'||
      profile.incoming.critChance!==undefined&&!number(profile.incoming.critChance,0,1)||
      profile.incoming.critMultiplier!==undefined&&!number(profile.incoming.critMultiplier,1,10))fail('Invalid incoming critical settings');
    if(!combatSchools.includes(profile.incoming.school)||!number(profile.incoming.amount,1,1e8))fail('Invalid incoming damage test');
  }
}

function validateOwner(owner,talents,abilities,items=[],sets=[]){
  schema(owner,['kind','id','rank'],'Invalid passive source');
  const source=owner.kind==='talent'?talents.get(owner.id):['passive','ability'].includes(owner.kind)?abilities.get(owner.id):owner.kind==='set'?sets.find(set=>set.id===owner.id):items.find(item=>item.id===owner.id);
  if(!source||!['talent','passive','ability','item','set'].includes(owner.kind)||
    owner.kind==='passive'&&source.kind!=='passive'||
    owner.rank!==undefined&&(owner.kind!=='talent'||!Number.isInteger(owner.rank)||!number(owner.rank,1,source.maxRank)))fail('Invalid passive source reference');
}

export function removeRpgReferences(profile, kind, id){
  if(!profile)return;
  for(const list of ['bonuses','procs'])if(profile[list])profile[list]=profile[list].filter(rule=>
    !(rule.owner.kind===kind&&rule.owner.id===id)&&!(kind==='passive'&&(rule.spell===id||rule.sourceAbilityId===id||rule.owner.kind==='ability'&&rule.owner.id===id)));
  if(kind==='talent')for(const build of profile.builds??[])if(!build.combatSnapshot)delete build.talents[id];
  if(kind==='item')for(const equipped of [profile.equipped,...(profile.builds??[]).filter(build=>!build.combatSnapshot).map(build=>build.equipped)]) {
    for(const [slot,value] of Object.entries(equipped??{}))if(value===id)delete equipped[slot];
  }
}

function validateStateCondition(state) {
  if(state===undefined)return;
  schema(state,['key','value'],'Invalid class state condition');
  if(!['form','stance','aspect','seal','mode'].includes(state.key)||!text(state.value,1,60))fail('Invalid class state condition');
}
export const stateMatches=(rule,states={})=>!rule.state||states[rule.state.key]===rule.state.value;

export function validateCondition(condition,resources,talents,abilities,depth=0){
  if(depth>2)fail('Condition nesting is limited to three levels');
  schema(condition,['type','value','resource','conditions','condition','target','stacks','key','rank','window','abilityId'],'Invalid combat condition');
  const {type,value}=condition;
  if(['all','any'].includes(type)){
    if(Object.keys(condition).some(key=>!['type','conditions'].includes(key))||!Array.isArray(condition.conditions)||!condition.conditions.length||condition.conditions.length>8)fail('Invalid condition group');
    condition.conditions.forEach(child=>validateCondition(child,resources,talents,abilities,depth+1));return;
  }
  if(type==='not'){
    if(Object.keys(condition).some(key=>!['type','condition'].includes(key)))fail('Invalid condition negation');
    validateCondition(condition.condition,resources,talents,abilities,depth+1);return;
  }
  const valid={
    playerBelow:()=>number(value,0,100),dummyBelow:()=>number(value,0,100),critical:()=>value===true,
    playerStatus:()=>text(value,1,100),dummyStatus:()=>text(value,1,100),
    resourceAbove:()=>resources.includes(condition.resource)&&number(value,0,1e8),
    resourceBelow:()=>resources.includes(condition.resource)&&number(value,0,1e8),
    school:()=>combatSchools.includes(value),weapon:()=>itemTypes.includes(value),
    auraStacks:()=>['player','dummy'].includes(condition.target)&&text(value,1,100)&&Number.isInteger(condition.stacks)&&number(condition.stacks,1,10),
    state:()=>['form','stance','aspect','seal','mode'].includes(condition.key)&&text(value,1,60),
    talentRank:()=>talents.has(value)&&Number.isInteger(condition.rank)&&number(condition.rank,1,talents.get(value).maxRank),
    previousEvent:()=>procEvents.includes(value)&&number(condition.window,.01,300)&&(!Object.hasOwn(condition,'abilityId')||abilities.has(condition.abilityId))
  };
  if(!Object.hasOwn(valid,type)||!valid[type]())fail('Invalid combat condition value');
}

export function validateItemSource(source){
  schema(source,['provider','version','itemId','url','fetchedAt','responseSha256','inventorySlot','subclass','tooltipText','imported','unmodeled'],'Invalid item source');
  if(source.provider!=='wowhead'||source.version!=='cataclysm'||!Number.isInteger(source.itemId)||!number(source.itemId,1,2147483647)||source.url!==`https://www.wowhead.com/cata/item=${source.itemId}`||
    typeof source.fetchedAt!=='string'||source.fetchedAt.length>40||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|\+00:00)$/.test(source.fetchedAt)||!Number.isFinite(Date.parse(source.fetchedAt))||new Date(source.fetchedAt).getUTCFullYear()<1||new Date(source.fetchedAt).toISOString().slice(0,19)!==source.fetchedAt.slice(0,19)||
    typeof source.responseSha256!=='string'||!(/^[a-f0-9]{64}$/).test(source.responseSha256)||!Number.isInteger(source.inventorySlot)||!number(source.inventorySlot,1,28)||!Number.isInteger(source.subclass)||!number(source.subclass,0,100)||
    typeof source.tooltipText!=='string'||source.tooltipText.length>20000)fail('Invalid item source');
  for(const key of ['imported','unmodeled'])if(!Array.isArray(source[key])||source[key].length>128||source[key].some(value=>typeof value!=='string'||!value||value.length>200))fail('Invalid item import details');
}
