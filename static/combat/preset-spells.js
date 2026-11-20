// Configurations transcribed from the descriptions shipped with the Cataclysm presets.
const damage = (school, baseAmount, extra={}) => ({
  id: 'damage', type:'damage', trigger:'onHit', school, baseAmount, scalingStat:'none', coefficient:0, canCrit:true, ...extra
});
const melee = {delivery:'melee',targeting:'dummy',attackAnimation:'sword',impact:'melee'};
const ranged = (impact, projectile='none') => ({delivery:'ranged',targeting:'dummy',projectile,impact,attackAnimation:'cast'});
const passiveSchool = (school,name,amount) => ({
  combatEffects:[{id:'school-power',type:'status',trigger:'onCast',target:'player',
    name,stat:'damageDone',school,amount,duration:1}]
});
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
  'cata-warrior-0-spec-12294': spell(melee,[damage('physical',94,{weaponCoefficient:.8})])
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
  'cata-warrior-0-spec-12294':'Урон оружием по манекену. Манекен не получает лечение.'
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
