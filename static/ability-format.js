export const equipmentRequirementLabels=['Ткань','Кожа','Кольчуга','Латы','Щиты','Одноручные мечи','Двуручные мечи','Одноручные топоры','Двуручные топоры','Одноручные дробящие','Двуручные дробящие','Кинжалы','Посохи','Древковое','Кистевое','Луки','Арбалеты','Ружья','Жезлы','Метательное','Левая рука'];
export function abilityRequirementsText(ability){return Array.isArray(ability.requirements)?ability.requirements.join(', '):(ability.requirements||'');}
export function abilityStatLines(ability,cost='0'){
 const lines=ability.kind==='passive'?['Пассивная способность']:[
  'Стоимость: '+cost,
  'Применение: '+(ability.channeled?'Поддерживаемое'+(ability.cast?' ('+ability.cast+' сек.)':''):ability.cast?ability.cast+' сек.':'Мгновенное'),
  'Восстановление: '+(ability.cooldown?ability.cooldown+' сек.':'Нет'),
  'Дальность: '+(ability.range?ability.range+' м':'Ближний бой')
 ];
 const requirements=abilityRequirementsText(ability);if(requirements.trim())lines.push('Требуется: '+requirements);
 return lines;
}
