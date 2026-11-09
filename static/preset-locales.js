const classes={warrior:['Воин','Warrior'],paladin:['Паладин','Paladin'],hunter:['Охотник','Hunter'],rogue:['Разбойник','Rogue'],priest:['Жрец','Priest'],deathknight:['Рыцарь смерти','Death Knight'],shaman:['Шаман','Shaman'],mage:['Маг','Mage'],warlock:['Чернокнижник','Warlock'],druid:['Друид','Druid']};
export function presetClassName(id,language='en'){
 const key=id.replace(/^(?:forever|tbc|cata)-/,'');
 return classes[key]?.[language==='ru'?0:1]||id;
}
export function applyPresetLocale(document,id,language='en',locale=null){
 const result=structuredClone(document),lang=language==='ru'?'ru':'en';
 result.name=presetClassName(id,lang)+' · '+result.source.version;
 if(lang==='ru'){
  if(!locale||locale.language!==lang||locale.presetId!==id)throw Error('Не удалось загрузить русский набор талантов');
  const branches=new Map(locale.branches.map(b=>[b.id,b])),abilities=new Map(locale.abilities.map(a=>[a.id,a]));
  for(const branch of result.branches){
   const translated=branches.get(branch.id);if(!translated)throw Error('Русский набор не соответствует дереву');
   branch.name=translated.name;const talents=new Map(translated.talents.map(t=>[t.id,t]));
   for(const talent of branch.talents){const t=talents.get(talent.id);if(!t||t.descriptions.length!==talent.maxRank)throw Error('Русский набор не соответствует дереву');talent.name=t.name;talent.descriptions=[...t.descriptions];delete talent.rankTemplate;}
  }
  for(const ability of result.abilities){const a=abilities.get(ability.id);if(!a)throw Error('Русский набор не соответствует дереву');ability.name=a.name;ability.description=a.description;if(a.requirements!==undefined)ability.requirements=a.requirements;}
 }
 const labels={'Человек':'Human','Мужской':'Male','Мана':'Mana','Ярость':'Rage','Энергия':'Energy','Приёмы':'Combo points','Энергия затмения':'Eclipse energy','Сила света':'Holy Power','Сила рун':'Runic Power','Руны крови':'Blood runes','Руны льда':'Frost runes','Руны нечестивости':'Unholy runes','Концентрация':'Focus','Фокус':'Focus','Руны':'Runes','Светлая сила':'Holy Power','Осколки души':'Soul Shards','Осколки душ':'Soul Shards','Здоровье':'Health'};
 if(lang==='en'&&result.character){for(const key of ['race','gender'])result.character[key]=labels[result.character[key]]||result.character[key];for(const resource of result.character.resources)resource.name=labels[resource.name]||resource.name;
  for(const ability of result.abilities){for(const cost of ability.resourceCosts||[])cost.resourceName=labels[cost.resourceName]||cost.resourceName;if(ability.requirements==='Уровень 80')ability.requirements='Level 80';}
 }
 result.source={...result.source,language:lang,localization:lang==='ru'?locale.provenance:{kind:'original'}};
 if(lang==='en'&&result.source.notice)result.source.notice='Client snapshot 1.60.1.69876 (September 16, 2026). May differ from current Wowhead. Three off-grid nodes and one invalid backwards hunter link were excluded.';
 return result;
}
