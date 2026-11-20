// Configurations transcribed from the descriptions shipped with the Cataclysm presets.
const damage = (school, baseAmount, extra={}) => ({
  id: 'damage', type:'damage', trigger:'onHit', school, baseAmount, scalingStat:'none', coefficient:0, canCrit:true, ...extra
});
const melee = {delivery:'melee',targeting:'dummy',attackAnimation:'sword',impact:'melee'};
const ranged = (impact, projectile='none') => ({delivery:'ranged',targeting:'dummy',projectile,impact,attackAnimation:'cast'});
const aura=(id,name,stat,amount,extra={})=>({id,type:'status',trigger:'onCast',target:'player',name,stat,amount,duration:1,...extra});
const passive = (name,stat,amount) => ({combatEffects:[aura('bonus',name,stat,amount)]});
const schoolAura=(school,name,amount)=>aura('bonus-'+school,name,'damageDone',amount,{school});
const passiveSchool = (school,name,amount) => ({combatEffects:[schoolAura(school,name,amount)]});
const heal=(amount,extra={})=>({id:'heal',type:'healing',trigger:'onCast',baseAmount:amount,scalingStat:'none',coefficient:0,canCrit:true,...extra});
const self={targeting:'self',animation:'area',impact:'healing'};
const gain=(resourceId,amount)=>({id:'resource',type:'resource',trigger:'onHit',resourceId,amount,unit:'points'});
const spell = (presentation, combatEffects, workshop) => ({presentation,combatEffects,...(workshop?{workshop}:{})});

const configurations = {
  'cata-deathknight-0-spec-55050': spell(melee,[damage('physical',250,{weaponCoefficient:1.75})]),
  'cata-deathknight-1-spec-49143': spell({...melee,impact:'frost'},[damage('frost',87,{weaponCoefficient:1.3})]),
  'cata-deathknight-2-spec-55090': spell(melee,[damage('physical',340,{weaponCoefficient:1})]),
  'cata-hunter-1-spec-19434': spell({...ranged('melee','straight'),attackAnimation:'bow'},[damage('physical',0,{weaponCoefficient:1.32})]),
  'cata-mage-0-spec-44425': spell(ranged('arcane','straight'),[damage('arcane',423)]),
  'cata-mage-0-spec-84671': passiveSchool('arcane','Arcane Specialization',25),
  'cata-mage-1-spec-11366': spell(ranged('fire','straight'),[
    damage('fire',187), damage('fire',14,{id:'burn',duration:12,interval:3,canCrit:false})
  ]),
  'cata-mage-1-spec-84668': passiveSchool('fire','Fire Specialization',25),
  'cata-mage-2-spec-84669': passiveSchool('frost','Frost Specialization',25),
  'cata-paladin-1-spec-31935': spell(ranged('holy','straight'),[damage('holy',536)]),
  'cata-priest-2-spec-15407': spell({...ranged('shadow'),channelDuration:3,castingAnimation:'channel'},[
    damage('shadow',10)
  ],{version:1,tickInterval:1,interruptMovement:true}),
  'cata-shaman-0-spec-51490': spell({delivery:'ranged',targeting:'area',projectile:'none',impact:'nature',animation:'area'},[
    damage('nature',629),
    {id:'restore-mana',type:'resource',trigger:'onCast',resourceId:'cata:mana',unit:'percent',amount:8}
  ],{version:1,radius:10}),
  'cata-warlock-0-spec-30108': spell(ranged('shadow'),[damage('shadow',110,{duration:15,interval:3,canCrit:false})]),
  'cata-warlock-0-spec-87339': passiveSchool('shadow','Shadow Mastery',30),
  'cata-warrior-0-spec-12294': spell(melee,[damage('physical',94,{weaponCoefficient:.8})]),
  // Some source tooltips contain placeholders or mechanics outside the single-target arena.
  // The limitations and provisional tuning are declared below.
  'cata-druid-0-spec-78674': spell(ranged('arcane','straight'),[damage('arcane',140,{spellCoefficient:.4}),gain('cata:eclipse',15)]),
  'cata-druid-1-spec-33917': spell(melee,[damage('physical',105,{attackCoefficient:.3})]),
  'cata-druid-2-spec-18562': spell(self,[heal(160,{spellCoefficient:.45})]),
  'cata-hunter-2-spec-53301': spell(ranged('fire','straight'),[
    damage('fire',75,{attackCoefficient:.2}),damage('fire',30,{id:'aftershock',duration:2,interval:1,attackCoefficient:.08})
  ]),
  'cata-paladin-0-spec-20473': spell(ranged('holy'),[damage('holy',340),gain('cata:holy',1)]),
  'cata-paladin-2-spec-85256': spell({...melee,impact:'holy'},[damage('physical',55,{weaponCoefficient:.9})]),
  'cata-priest-0-spec-47540': spell({...ranged('holy'),channelDuration:3,castingAnimation:'channel'},[damage('holy',55,{spellCoefficient:.16})],
    {version:1,tickInterval:1,interruptMovement:true}),
  'cata-priest-1-spec-88625': spell(ranged('holy'),[damage('holy',105,{spellCoefficient:.25})]),
  'cata-rogue-0-spec-1329': spell(melee,[damage('physical',44,{weaponCoefficient:.75}),gain('cata:combo',2)]),
  'cata-rogue-2-spec-36554': spell({targeting:'self',animation:'guard',impact:'shadow'},[
    {...aura('speed','Shadowstep','movementSpeed',70),duration:3}
  ]),
  'cata-shaman-1-spec-60103': spell({...melee,impact:'fire'},[damage('fire',85,{attackCoefficient:.32})]),
  'cata-shaman-2-spec-974': spell(self,[heal(150,{duration:9,interval:3,canCrit:false})]),
  'cata-warlock-2-spec-17962': spell(ranged('fire'),[damage('fire',140,{spellCoefficient:.42})]),
  'cata-warrior-1-spec-23881': spell(melee,[damage('physical',45,{attackCoefficient:.43})]),
  'cata-warrior-2-spec-23922': spell({...melee,attackAnimation:'guard'},[damage('physical',308)]),
  'cata-druid-0-spec-16913': {combatEffects:[schoolAura('arcane','Moonfury',10),schoolAura('nature','Moonfury',10)]},
  'cata-druid-1-spec-84735': passive('Aggression','attackPower',25),
  'cata-druid-2-spec-87305': passive('Gift of Nature','healingDone',25),
  'cata-hunter-0-spec-87325': passive('Animal Handler','attackPower',30),
  'cata-paladin-0-spec-85102': passive('Walk in the Light','healingDone',10),
  'cata-priest-1-spec-87336': passive('Spiritual Healing','healingDone',15),
  'cata-rogue-1-spec-61329': {combatEffects:[aura('ap','Vitality','attackPower',30),aura('regen','Vitality','resourceRegen',25)]},
  'cata-shaman-1-spec-77223': {combatEffects:['fire','frost','nature'].map(school=>schoolAura(school,'Enhanced Elements',20))},
  'cata-shaman-2-spec-16213': passive('Purification','healingDone',25),
  'cata-warlock-1-spec-84740': {combatEffects:['fire','shadow'].map(school=>schoolAura(school,'Demonic Knowledge',15))},
  'cata-warlock-2-spec-84739': passiveSchool('fire','Cataclysm',25),
  'cata-warlock-2-spec-77220': passiveSchool('fire','Fiery Apocalypse',10.8),
  'cata-deathknight-1-spec-77514': passiveSchool('frost','Frozen Heart',16),
  'cata-deathknight-2-spec-77515': passiveSchool('shadow','Dreadblade',20)
};

export const partialPresetSpells = {
  'cata-deathknight-0-spec-55050':'Основной удар по манекену. Бонус от болезней и дополнительные цели отсутствуют.',
  'cata-deathknight-2-spec-55090':'Физический удар. Дополнительный урон за болезни требует отдельной настройки.',
  'cata-hunter-1-spec-19434':'Используется урон экипированного дальнего оружия. Дополнительное масштабирование из источника не определено.',
  'cata-mage-2-spec-84669':'Общий бонус Льда. Дополнительный бонус Frostbolt требует отдельной настройки.',
  'cata-paladin-1-spec-31935':'Урон по манекену. Прерывание и отскоки требуют дополнительных механик.',
  'cata-priest-2-spec-15407':'Канал наносит три тика урона. Манекен неподвижен.',
  'cata-shaman-0-spec-51490':'Урон вокруг героя и восстановление маны. Манекен остаётся неподвижным.',
  'cata-warlock-0-spec-30108':'Периодический урон по манекену. Ответ на рассеивание и взаимоисключение эффектов требуют отдельной настройки.',
  'cata-warrior-0-spec-12294':'Урон оружием по манекену. Манекен не получает лечение.',
  'cata-druid-0-spec-78674':'Предварительные коэффициенты Talent Forge. Таинственный урон и 15 единиц единой шкалы затмения.',
  'cata-druid-1-spec-33917':'Адаптация Talent Forge. Предварительный удар без стойки зверя и проверки кровотечения.',
  'cata-druid-2-spec-18562':'Предварительное лечение Talent Forge. Условие поглощения HoT требует ручной настройки.',
  'cata-hunter-2-spec-53301':'Три огненных попадания с предварительными коэффициентами Talent Forge.',
  'cata-paladin-0-spec-20473':'Враждебный вариант с зарядом Светлой силы. Лечение оформляется отдельным шаблоном.',
  'cata-paladin-2-spec-85256':'Адаптация Talent Forge с фиксированным уроном оружием. Масштабирование по числу зарядов требует ручной настройки.',
  'cata-priest-0-spec-47540':'Враждебный канал. Числа предварительные. Лечение оформляется отдельно.',
  'cata-priest-1-spec-88625':'Предварительный святой урон Talent Forge. Дезориентация неподвижной цели не моделируется.',
  'cata-rogue-0-spec-1329':'Основная рука и два приёма. Вторую руку нужно моделировать дополнительно.',
  'cata-rogue-2-spec-36554':'Адаптация Talent Forge сохраняет ускорение на три секунды. Перемещение за цель и комбинированный бонус отсутствуют.',
  'cata-shaman-1-spec-60103':'Предварительный огненный удар Talent Forge. Требование второй руки и зачарование нуждаются в настройке.',
  'cata-shaman-2-spec-974':'Адаптация Talent Forge лечит героя по времени. Реакция на полученный удар и девять зарядов отсутствуют.',
  'cata-warlock-2-spec-17962':'Предварительный прямой урон Talent Forge. Зависимость от Immolate нужно настроить отдельно.',
  'cata-warrior-1-spec-23881':'Коэффициент атаки из источника плюс предварительная база Talent Forge. Последующие лечебные попадания отсутствуют.',
  'cata-warrior-2-spec-23922':'Физическая база из источника. Масштабирование и рассеивание требуют отдельной настройки.',
  'cata-druid-0-spec-16913':'Школьные множители. Дополнительный крит перечисленных заклинаний требует отдельной настройки.',
  'cata-paladin-0-spec-85102':'Общий множитель лечения. Эффект Word of Glory настраивается отдельно.',
  'cata-rogue-1-spec-61329':'Сила атаки и общее восстановление ресурса. В документе с одним ресурсом это энергия.',
  'cata-shaman-1-spec-77223':'Базовый бонус трёх школ. Множитель мастерства специфичен для исходной механики.',
  'cata-shaman-2-spec-16213':'Общий множитель лечения. Конкретные времена применения настраиваются отдельно.',
  'cata-warlock-2-spec-77220':'Базовый огненный бонус. Дополнительный множитель мастерства отсутствует.',
  'cata-deathknight-1-spec-77514':'Базовый ледяной бонус. Дополнительный множитель мастерства отсутствует.',
  'cata-deathknight-2-spec-77515':'Базовый теневой бонус. Дополнительный множитель мастерства отсутствует.'
};

export const unsupportedPresetSpells = {
  'cata-hunter-0-spec-19577':'Требуется питомец.',
  'cata-mage-2-spec-31687':'Требуется призванный союзник.',
  'cata-warlock-1-spec-30146':'Требуется призванный союзник.',
  'cata-rogue-1-spec-13877':'Требуется дополнительная враждебная цель.'
};

export function applyPresetSpell(ability, character) {
  if (ability.combatEffects!==undefined || ability.presentation || ability.workshop) return;
  if (!Number.isInteger(ability.sourceSpellId)||!ability.id.endsWith('-spec-'+ability.sourceSpellId)) return;
  const config=Object.hasOwn(configurations,ability.id) && configurations[ability.id];
  if (!config) return;
  const resources=character?.resources??[];
  if (config.combatEffects.some(effect=>effect.type==='resource'&&!resources.some(resource=>resource.id===effect.resourceId))) return;
  Object.assign(ability,structuredClone(config));
}
