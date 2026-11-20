import {classResources} from '../resource-costs.js';

export const classTemplateLabels = {
  warrior:['Воин','Warrior'], paladin:['Паладин','Paladin'], hunter:['Охотник','Hunter'],
  rogue:['Разбойник','Rogue'], priest:['Жрец','Priest'], shaman:['Шаман','Shaman'],
  mage:['Маг','Mage'], warlock:['Чернокнижник','Warlock'], druid:['Друид','Druid'],
  deathknight:['Рыцарь смерти','Death Knight']
};

// All numbers in this table are preliminary Talent Forge tuning values.
const classes = {
  warrior:{school:'physical',style:'sword',resource:'rage',names:[['Удар клинком','Blade Strike'],['Сокрушающий взмах','Crushing Swing'],['Грозный выпад','Forceful Lunge']],dot:true, aura:'attackPower'},
  paladin:{school:'holy',style:'sword',resource:'mana',names:[['Светлый удар','Radiant Strike'],['Клинок рассвета','Dawn Blade'],['Круг рассвета','Dawn Circle']],heal:true, aura:'healingPower'},
  hunter:{school:'physical',style:'bow',resource:'focus',names:[['Точный выстрел','Precise Shot'],['Пробивная стрела','Piercing Arrow'],['Россыпь стрел','Arrow Volley']],dot:true, aura:'attackPower'},
  rogue:{school:'physical',style:'sword',resource:'energy',names:[['Быстрый порез','Quick Cut'],['Теневая засечка','Shadow Cut'],['Точный выпад','Precise Lunge']],dot:true, aura:'critChance'},
  priest:{school:'holy',style:'cast',resource:'mana',names:[['Вспышка света','Light Flash'],['Луч очищения','Purifying Ray'],['Кольцо света','Ring of Light']],heal:true, aura:'spellPower'},
  shaman:{school:'nature',style:'cast',resource:'mana',names:[['Зелёная искра','Verdant Spark'],['Зов грозы','Stormcall'],['Раскат грома','Thunder Pulse']],dot:true,heal:true,aura:'spellPower'},
  mage:{school:'frost',style:'cast',resource:'mana',names:[['Ледяное копьё','Glacial Lance'],['Кристальный град','Crystal Hail'],['Морозный круг','Circle of Frost']],dot:true, aura:'spellPower'},
  warlock:{school:'shadow',style:'cast',resource:'mana',names:[['Теневой осколок','Shadow Shard'],['Печать сумрака','Dusk Mark'],['Кольцо сумрака','Dusk Ring']],dot:true, aura:'spellPower'},
  druid:{school:'nature',style:'cast',resource:'mana',names:[['Колючая ветвь','Thorn Branch'],['Лунный всплеск','Moon Flare'],['Круг шипов','Thorn Circle']],dot:true,heal:true,aura:'spellPower'},
  deathknight:{school:'frost',style:'sword',resource:'runicPower',names:[['Рунический удар','Runic Strike'],['Морозный клинок','Rime Blade'],['Ледяной круг','Rime Circle']],dot:true, aura:'attackPower'}
};
const resources = {
  mana:['Мана','Mana','#397de1'],rage:['Ярость','Rage','#b74444'],energy:['Энергия','Energy','#d9a72f'],
  focus:['Концентрация','Focus','#bf7e3a'],runicPower:['Сила рун','Runic Power','#38adb5']
};
const icons = {physical:'steel',frost:'frost',holy:'light',nature:'nature',shadow:'arcane'};
const localized = (pair,language)=>pair[language==='ru'?0:1];
const themes={
  physical:['rangedProjectile','meleeImpact','heavyStrike'],holy:['arcaneProjectile','arcaneImpact','arcaneExplosion'],
  frost:['frostbolt','frostImpact','frostNova'],nature:['natureProjectile','poisonImpact','natureBurst'],
  shadow:['shadowProjectile','shadowImpact','darkEnergy']
};
const tuning = ['Авторский шаблон Talent Forge. Значения предварительные.','Talent Forge template. Values are provisional.'];
const title = (ru,en)=>[ru,en];
const damage = (school,amount,scalingStat,coefficient,extra={}) => ({
  id:'damage', type:'damage', trigger:'onHit', school, baseAmount:amount, scalingStat, coefficient, canCrit:true,...extra
});
const status = (name,stat,amount,duration)=>({id:'buff',type:'status',trigger:'onCast',target:'player',name,stat,amount,duration});

export function templateClassForPreset(presetId) {
  const key=presetId?.replace(/^(?:forever|tbc|cata)-/,'');
  return Object.hasOwn(classes,key)?key:undefined;
}

function matchingResource(character,key) {
  const choices=classResources(character).slice(1);
  const [ru,en]=resources[key];
  return choices.find(resource=>resource.id.toLowerCase().replace(/[^a-z]/g,'').endsWith(key.toLowerCase())
    ||[ru,en].includes(resource.name))??choices[0];
}

export function classSpellTemplates(classId,character,language='en') {
  const row=Object.hasOwn(classes,classId)&&classes[classId];
  if(!row)return [];
  const {school,style,names,aura}=row;
  const melee=style==='sword', magical=style==='cast';
  const resource=matchingResource(character,row.resource);
  const scaling=magical?'spellPower':'attackPower';
  const impact=school==='physical'?'melee':school;
  const [projectilePreset,effectPreset,areaPreset]=themes[school];
  const attack={category:'attack',targeting:'dummy',delivery:melee?'melee':'ranged',attackAnimation:style,impact,
    effectPreset,projectile:melee?'none':'straight',
    ...(!melee?{projectilePreset,projectileOrigin:style==='bow'?'weapon':'hand'}:{})};
  const self={targeting:'self',animation:'guard',impact:'defense'};
  const entry=(key,name,description,effects,presentation,{cast=0,cooldown=0,range=0,cost=0,passive=false}={})=>({
    id:'tf-class-'+classId+'-'+key,name:localized(name,language),description:localized(description,language)+' '+localized(tuning,language),
    icon:'forge-'+(icons[school]??'arcane'),kind:passive?'passive':'active',learningMode:'base',cast,cooldown,range,
    resourceCosts:resource&&cost?[{resourceId:resource.id,resourceName:resource.name,amount:cost,unit:'percent'}]:[],
    combatEffects:effects,...(!passive?{presentation,workshop:{version:1}}:{})
  });
  const entries=[
    entry('strike',names[0],title('Базовая атака одной цели.','Basic single-target attack.'),
      [damage(school,45,scaling,.15)],attack,{range:melee?2:26}),
    entry('heavy',names[1],title('Усиленная атака одной цели.','Stronger single-target attack.'),
      [damage(school,125,scaling,.45)],{...attack,...(magical?{projectile:'homing',castingAnimation:'cast'}:{})},
      {range:melee?2:26,cooldown:3,cost:14,cast:magical?1.25:0}),
    entry('burst',names[2],title('Урон манекену в области вокруг героя.','Damages the dummy within an area around the hero.'),
      [damage(school,100,scaling,.3)],{category:'area',targeting:'area',delivery:'ranged',projectile:'none',attackAnimation:'area',impact,effectPreset:areaPreset},
      {range:5,cooldown:10,cost:10}),
    entry('guard',title('Боевая защита','Combat Guard'),title('Щит на герое поглощает входящий урон в течение шести секунд.','A shield on the hero absorbs incoming damage for six seconds.'),
      [{id:'shield',type:'shield',trigger:'onCast',name:localized(title('Боевая защита','Combat Guard'),language),
        duration:6,amount:120,fraction:1,priority:10,coefficient:.15}],self,{cooldown:12}),
    entry('surge',title('Боевой резерв','Combat Reserve'),resource?title('Восстанавливает 25% основного ресурса.','Restores 25% of the primary resource.'):
      title('Восстанавливает здоровье героя без затрат ресурса.','Restores the hero’s health without a resource cost.'),
      [resource?{id:'reserve',type:'resource',trigger:'onCast',resourceId:resource.id,unit:'percent',amount:25}:
        {id:'recover',type:'healing',trigger:'onCast',baseAmount:40,scalingStat:'none',coefficient:0,canCrit:false}],self,{cooldown:14}),
    entry('focus',title('Боевая концентрация','Combat Focus'),title('Временное усиление исходящего урона.','Temporarily increases outgoing damage.'),
      [status(localized(title('Боевая концентрация','Combat Focus'),language),'damageDone',15,8)],self,{cooldown:16}),
    entry('discipline',title('Дисциплина бойца','Combat Discipline'),title('Постоянно повышает профильную характеристику.','Permanently increases the class’s combat statistic.'),
      [status(localized(title('Дисциплина бойца','Combat Discipline'),language),aura==='critChance'?'critChance':'damageDone',aura==='critChance'?5:10,1)],
      undefined,{passive:true})
  ];
  if(row.dot)entries.push(entry('linger',title('Затяжной удар','Lingering Strike'),title('Наносит три тика после попадания.','Deals three ticks after contact.'),
    [damage(school,24,scaling,.15,{duration:6,interval:2})],attack,{range:melee?2:26,cost:8,cooldown:7}));
  if(row.heal)entries.push(entry('mend',title('Восстановление героя','Mend the Hero'),title('Исцеляет героя сразу и затем ещё три раза.','Heals the hero immediately and three more times.'),
    [{id:'heal',type:'healing',trigger:'onCast',baseAmount:130,scalingStat:'spellPower',coefficient:.4,canCrit:true},
      {id:'renew',type:'healing',trigger:'onCast',baseAmount:25,scalingStat:'spellPower',coefficient:.12,canCrit:true,duration:6,interval:2}],
    {targeting:'self',category:'healing',animation:'area',impact:'healing'},{cast:1,cooldown:5,cost:12}));
  return entries;
}

export function starterCharacter(document,classId,language='en') {
  if(document.character)return document.character;
  const key=classes[classId].resource;
  const [ru,en,color]=resources[key];
  return {hp:10000,race:localized(['Человек','Human'],language),gender:localized(['Мужской','Male'],language),
    armory:'',resources:[{id:'tf:'+key,name:localized([ru,en],language),max:100,current:key==='rage'||key==='runicPower'?0:100,
      unit:'points',display:'bar',shape:'diamond',color}]};
}

export function installStarterLibrary(document,classId,language='en') {
  if(!Object.hasOwn(classes,classId))return document;
  const character=starterCharacter(document,classId,language);
  const ids=new Set(document.abilities.map(ability=>ability.id));
  const entries=classSpellTemplates(classId,character,language).filter(ability=>!ids.has(ability.id));
  return {...document,character,abilities:[...document.abilities,...entries]};
}
