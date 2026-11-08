export const equipmentRequirementLabels=['Ткань','Кожа','Кольчуга','Латы','Щиты','Одноручные мечи','Двуручные мечи','Одноручные топоры','Двуручные топоры','Одноручные дробящие','Двуручные дробящие','Кинжалы','Посохи','Древковое','Кистевое','Луки','Арбалеты','Ружья','Жезлы','Метательное','Левая рука'];
export function abilityStatLines(ability,cost='0'){
 const lines=ability.kind==='passive'?['Пассивная способность']:[
  'Стоимость: '+cost,
  'Применение: '+(ability.cast?ability.cast+' сек.':'Мгновенное'),
  'Восстановление: '+(ability.cooldown?ability.cooldown+' сек.':'Нет'),
  'Дальность: '+(ability.range?ability.range+' м':'Ближний бой')
 ];
 if(ability.requirements?.length)lines.push('Требуется: '+ability.requirements.join(', '));
 return lines;
}
