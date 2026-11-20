import {presentationRange} from './combat/presentation.js';

export const equipmentRequirementLabels=['Ткань','Кожа','Кольчуга','Латы','Щиты','Одноручные мечи','Двуручные мечи','Одноручные топоры','Двуручные топоры','Одноручные дробящие','Двуручные дробящие','Кинжалы','Посохи','Древковое','Кистевое','Луки','Арбалеты','Ружья','Жезлы','Метательное','Левая рука'];
export function abilityRequirementsText(ability){return Array.isArray(ability.requirements)?ability.requirements.join(', '):(ability.requirements||'');}
export function abilityStatLines(ability,cost=''){
 const presentation=ability.presentation;
 const legacyChannel=ability.channeled&&presentation?.channelDuration===undefined;
 const defaultRange=presentation?.targeting==='area'||presentation?.delivery==='ranged'||['straight','homing'].includes(presentation?.projectile);
 const lines=ability.kind==='passive'?['Пассивная способность']:[
  ...(cost&&Number.parseFloat(cost)!==0?['Стоимость: '+cost]:[]),
  'Применение: '+(legacyChannel?'Поддерживаемое'+(ability.cast?' ('+ability.cast+' сек.)':''):ability.cast?ability.cast+' сек.':'Мгновенное'),
  ...(presentation?.channelDuration ? ['Поддержание: '+presentation.channelDuration+' сек.'] : []),
  'Восстановление: '+(ability.cooldown?ability.cooldown+' сек.':'Нет'),
  'Дальность: '+(presentation?.targeting==='self'?'На себя':ability.range||defaultRange?presentationRange(ability.range,presentation)+' м':'Ближний бой')
 ];
 const requirements=abilityRequirementsText(ability);if(requirements.trim())lines.push('Требуется: '+requirements);
 return lines;
}
